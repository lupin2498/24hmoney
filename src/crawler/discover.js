import { JSDOM, VirtualConsole } from "jsdom";
import { cleanText } from "../util.js";

const quietConsole = () => new VirtualConsole();

/** Các hàm chuẩn hoá/nhận diện URL của nguồn tin (mặc định 24hmoney.vn). */
export function createUrlTools({ baseUrl, articlePath, listingPath }) {
  const base = new URL(baseUrl);
  const host = base.hostname.replace(/^www\./, "");
  const articleRe = new RegExp(`^${articlePath}$`, "i");
  const listingRe = new RegExp(`^${listingPath}/?$`, "i");

  function normalize(href, pageUrl = base) {
    if (!href) return null;
    try {
      const u = new URL(String(href).trim(), pageUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      if (u.hostname.replace(/^www\./, "") !== host) return null;
      u.protocol = base.protocol;
      u.host = base.host;
      u.hash = "";
      u.search = "";
      return u.toString();
    } catch {
      return null;
    }
  }

  const pathOf = (url) => {
    try {
      return new URL(url).pathname;
    } catch {
      return "";
    }
  };

  return {
    base,
    host,
    normalize,
    isArticle: (url) => articleRe.test(pathOf(url)),
    isListing: (url) => listingRe.test(pathOf(url)),
    articlePath,
  };
}

/** ID ổn định của bài viết: phần "c<số>a<số>" ở cuối URL của 24HMoney, nếu không có thì băm URL. */
export function articleIdFromUrl(url) {
  const m = String(url).match(/-(c\d+a\d+)\.html$/i);
  if (m) return m[1].toLowerCase();
  let h = 2166136261;
  for (const ch of String(url)) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return `u${h.toString(36)}`;
}

/** Số thứ tự bài (phần "a<số>") – dùng để ưu tiên bài mới hơn khi chưa biết giờ đăng. */
export function articleSeq(url) {
  const m = String(url).match(/a(\d+)\.html$/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Lấy link bài viết, link chuyên mục và link RSS từ một trang danh sách.
 * Ngoài thẻ <a>, còn quét cả dữ liệu nhúng (ví dụ window.__NUXT__) vì một số
 * danh sách tin chỉ được dựng ở phía trình duyệt.
 */
export function extractLinks(html, pageUrl, tools) {
  const articles = new Map();
  const listings = new Set();
  const feeds = new Set();

  const dom = new JSDOM(html, { url: pageUrl, virtualConsole: quietConsole() });
  const doc = dom.window.document;

  for (const a of doc.querySelectorAll("a[href]")) {
    const url = tools.normalize(a.getAttribute("href"), pageUrl);
    if (!url) continue;
    if (tools.isArticle(url)) {
      const text = cleanText(a.getAttribute("title") || a.textContent).replace(/\s+/g, " ");
      const hint = text.length >= 15 && text.length <= 300 ? text : "";
      const prev = articles.get(url);
      if (!prev) articles.set(url, { url, titleHint: hint });
      else if (hint.length > prev.titleHint.length) prev.titleHint = hint;
    } else if (tools.isListing(url) && url !== tools.normalize(pageUrl)) {
      listings.add(url);
    }
  }

  for (const link of doc.querySelectorAll('link[rel="alternate"][href]')) {
    const type = (link.getAttribute("type") || "").toLowerCase();
    if (type.includes("rss") || type.includes("atom")) {
      try {
        feeds.add(new URL(link.getAttribute("href"), pageUrl).toString());
      } catch {
        /* bỏ qua link hỏng */
      }
    }
  }

  // Quét đường dẫn bài viết xuất hiện trong mã nguồn (JSON nhúng, script...).
  const raw = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  const scanRe = new RegExp(`(https?://[^\\s"'<>]*?)?(${tools.articlePath})`, "gi");
  let m;
  while ((m = scanRe.exec(raw))) {
    const prevChar = m.index > 0 ? raw[m.index - 1] : "";
    if (!m[1] && prevChar && !`"'=( >\n\t`.includes(prevChar)) continue;
    const url = tools.normalize(m[0], pageUrl);
    if (url && tools.isArticle(url) && !articles.has(url)) articles.set(url, { url, titleHint: "" });
  }

  dom.window.close();
  return { articles: [...articles.values()], listings: [...listings], feeds: [...feeds] };
}

function decodeXml(s) {
  return String(s)
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1].trim()) : null;
}

/** Phân tích sitemap.xml (cả sitemap index và urlset, có hỗ trợ Google News sitemap). */
export function parseSitemap(xml) {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const blocks = xml.match(isIndex ? /<sitemap>[\s\S]*?<\/sitemap>/gi : /<url>[\s\S]*?<\/url>/gi) || [];
  const entries = blocks
    .map((b) => ({
      loc: tag(b, "loc"),
      lastmod: tag(b, "lastmod"),
      title: tag(b, "news:title"),
      publishedAt: tag(b, "news:publication_date"),
    }))
    .filter((e) => e.loc);
  return { isIndex, entries };
}

/** Phân tích RSS 2.0 hoặc Atom. */
export function parseFeed(xml) {
  const items = [];
  for (const b of xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || []) {
    items.push({
      url: tag(b, "link") || tag(b, "guid"),
      title: tag(b, "title"),
      publishedAt: tag(b, "pubDate") || tag(b, "dc:date"),
      description: tag(b, "description"),
    });
  }
  for (const b of xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []) {
    const href = b.match(/<link[^>]*href=["']([^"']+)["']/i);
    items.push({
      url: href ? decodeXml(href[1]) : null,
      title: tag(b, "title"),
      publishedAt: tag(b, "published") || tag(b, "updated"),
      description: tag(b, "summary"),
    });
  }
  return items.filter((i) => i.url);
}

export function toDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
