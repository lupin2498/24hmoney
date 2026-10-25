import { HttpClient, HttpError } from "./http.js";
import { isAllowed, parseRobots } from "./robots.js";
import {
  articleIdFromUrl,
  articleSeq,
  createUrlTools,
  extractLinks,
  parseFeed,
  parseSitemap,
  toDate,
} from "./discover.js";
import { parseArticle } from "./article.js";
import { createLogger, mapLimit } from "../util.js";

const ROBOTS_TTL_MS = 6 * 3600e3;
const MAX_SITEMAP_FETCHES = 6;
const MAX_UNDATED_SITEMAP_URLS = 50;

export class Crawler {
  constructor(source, { http, logger = createLogger("crawler"), now = () => new Date() } = {}) {
    this.cfg = source;
    this.tools = createUrlTools(source);
    this.http =
      http ||
      new HttpClient({
        userAgent: source.userAgent,
        timeoutMs: source.timeoutMs,
        delayMs: source.delayMs,
        concurrency: source.concurrency,
      });
    this.log = logger;
    this.now = now;
    this.robots = null;
    this.robotsAt = 0;
  }

  async #loadRobots() {
    if (this.robots && Date.now() - this.robotsAt < ROBOTS_TTL_MS) return this.robots;
    try {
      const res = await this.http.getText(new URL("/robots.txt", this.tools.base).toString(), {
        accept: "text/plain,*/*",
      });
      this.robots = parseRobots(res.text);
    } catch (err) {
      this.robots = { sitemaps: [], rules: [] };
      if (!(err instanceof HttpError && err.status === 404)) this.log.warn("Không đọc được robots.txt:", err.message);
    }
    this.robotsAt = Date.now();
    return this.robots;
  }

  allowed(url) {
    const u = new URL(url);
    return isAllowed(this.robots, u.pathname + u.search);
  }

  /** Tìm các bài viết mới từ trang chủ, trang chuyên mục, RSS và sitemap. */
  async discover() {
    const robots = await this.#loadRobots();
    const cutoff = this.now().getTime() - this.cfg.maxAgeHours * 3600e3;
    const found = new Map();
    const errors = [];

    const add = (item, via) => {
      const url = this.tools.normalize(item.url);
      if (!url || !this.tools.isArticle(url) || !this.allowed(url)) return;
      const hinted = item.publishedHint ? Date.parse(item.publishedHint) : NaN;
      if (hinted < cutoff) return;
      const prev = found.get(url);
      if (!prev) {
        found.set(url, {
          url,
          id: articleIdFromUrl(url),
          titleHint: item.titleHint || "",
          publishedHint: Number.isNaN(hinted) ? null : new Date(hinted).toISOString(),
          via,
        });
      } else {
        if (!prev.titleHint && item.titleHint) prev.titleHint = item.titleHint;
        if (!prev.publishedHint && !Number.isNaN(hinted)) prev.publishedHint = new Date(hinted).toISOString();
      }
    };

    const listings = new Set();
    const feeds = new Set();
    const visitPage = async (pageUrl) => {
      try {
        const res = await this.http.getText(pageUrl);
        const links = extractLinks(res.text, res.url || pageUrl, this.tools);
        links.articles.forEach((a) => add(a, "page"));
        links.listings.forEach((l) => listings.add(l));
        links.feeds.forEach((f) => feeds.add(f));
      } catch (err) {
        errors.push(`${pageUrl}: ${err.message}`);
        this.log.warn("Lỗi tải trang danh sách", pageUrl, "-", err.message);
      }
    };

    const seeds = [...new Set(this.cfg.seedPages.map((p) => new URL(p, this.tools.base).toString()))];
    await mapLimit(seeds, 2, visitPage);
    const extra = [...listings]
      .filter((u) => !seeds.includes(u) && this.allowed(u))
      .slice(0, this.cfg.maxListingPages);
    await mapLimit(extra, 2, visitPage);

    for (const feedUrl of [...feeds].slice(0, 5)) {
      try {
        const res = await this.http.getText(feedUrl, {
          accept: "application/rss+xml,application/atom+xml,application/xml,text/xml,*/*",
        });
        for (const item of parseFeed(res.text)) {
          add({ url: item.url, titleHint: item.title, publishedHint: toDate(item.publishedAt)?.toISOString() }, "rss");
        }
      } catch (err) {
        errors.push(`${feedUrl}: ${err.message}`);
      }
    }

    if (this.cfg.useSitemaps) await this.#fromSitemaps(robots, add, errors, cutoff);

    // 24HMoney đánh số bài tăng dần (phần a<số> trong URL) nên sắp theo số này để ưu tiên bài mới.
    const items = [...found.values()].sort(
      (a, b) =>
        articleSeq(b.url) - articleSeq(a.url) ||
        (Date.parse(b.publishedHint || 0) || 0) - (Date.parse(a.publishedHint || 0) || 0),
    );
    return { items, errors, pages: seeds.length + extra.length };
  }

  async #fromSitemaps(robots, add, errors, cutoff) {
    const queue = robots.sitemaps.length
      ? robots.sitemaps.slice(0, 5)
      : [new URL("/sitemap.xml", this.tools.base).toString()];
    let budget = MAX_SITEMAP_FETCHES;
    while (queue.length && budget-- > 0) {
      const url = queue.shift();
      let xml;
      try {
        xml = (await this.http.getText(url, { accept: "application/xml,text/xml,*/*", maxBytes: 20e6 })).text;
      } catch (err) {
        if (!(err instanceof HttpError && err.status === 404)) errors.push(`${url}: ${err.message}`);
        continue;
      }
      const { isIndex, entries } = parseSitemap(xml);
      if (isIndex) {
        const ranked = entries
          .map((e, i) => ({
            loc: e.loc,
            i,
            t: toDate(e.lastmod)?.getTime() ?? 0,
            news: /news|tin|article|bai-viet/i.test(e.loc) ? 1 : 0,
          }))
          .filter((e) => !e.t || e.t >= cutoff)
          .sort((a, b) => b.news - a.news || b.t - a.t || b.i - a.i);
        queue.push(...ranked.slice(0, 3).map((e) => e.loc));
        continue;
      }
      const undated = [];
      for (const e of entries) {
        const t = toDate(e.publishedAt || e.lastmod);
        if (t) add({ url: e.loc, titleHint: e.title || "", publishedHint: t.toISOString() }, "sitemap");
        else undated.push(e);
      }
      // Sitemap không ghi ngày: chỉ lấy các bài có số thứ tự lớn nhất (mới nhất).
      undated
        .sort((a, b) => articleSeq(b.loc) - articleSeq(a.loc))
        .slice(0, MAX_UNDATED_SITEMAP_URLS)
        .forEach((e) => add({ url: e.loc, titleHint: e.title || "" }, "sitemap"));
    }
  }

  /** Tải và phân tích một bài viết. */
  async fetchArticle(candidate) {
    const res = await this.http.getText(candidate.url);
    const article = parseArticle(res.text, candidate.url, { now: this.now() });
    if (!article.title) article.title = candidate.titleHint || "";
    if (!article.publishedAt && candidate.publishedHint) {
      article.publishedAt = candidate.publishedHint;
      article.dateSource = candidate.via;
    }
    return article;
  }
}
