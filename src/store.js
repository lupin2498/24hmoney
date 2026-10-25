import fs from "node:fs/promises";
import path from "node:path";
import { addDays, createLogger, vnDateKey } from "./util.js";

const SEEN_TTL_MS = 7 * 86400e3;
const MAX_DIGEST_VERSIONS = 10;
const IMPACT_RANK = { cao: 3, trung_binh: 2, thap: 1 };

/** Bỏ dấu tiếng Việt và viết thường để tìm kiếm không phân biệt dấu. */
export function fold(text) {
  return String(text || "")
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const timeOf = (a) => Date.parse(a.publishedAt || a.discoveredAt || 0) || 0;

/** Dữ liệu trả về cho giao diện: bỏ nội dung gốc (chỉ dùng nội bộ để phân tích). */
export function publicArticle(a) {
  const { content, nextAttemptAt, ...rest } = a;
  return rest;
}

/**
 * Lưu trữ đơn giản bằng file JSON: mỗi ngày một file bài viết, một file bản tin,
 * cộng thêm meta.json (lần quét gần nhất, thống kê token, URL đã bỏ qua).
 */
export class Store {
  constructor(dir, { retentionDays = 30, logger = createLogger("store"), now = () => new Date() } = {}) {
    this.dir = dir;
    this.now = now;
    this.retentionDays = retentionDays;
    this.log = logger;
    this.articles = new Map();
    this.byUrl = new Map();
    this.digests = new Map();
    this.meta = { lastCrawl: null, usage: {}, seen: {} };
    this.dirtyDays = new Set();
    this.dirtyDigests = new Set();
    this.metaDirty = false;
    this.saveTimer = null;
    this.writing = Promise.resolve();
  }

  #file(kind, day) {
    return path.join(this.dir, kind, `${day}.json`);
  }

  async load() {
    await fs.mkdir(path.join(this.dir, "articles"), { recursive: true });
    await fs.mkdir(path.join(this.dir, "digests"), { recursive: true });
    const oldest = addDays(vnDateKey(this.now()), -this.retentionDays);

    for (const kind of ["articles", "digests"]) {
      for (const name of await fs.readdir(path.join(this.dir, kind))) {
        const day = name.replace(/\.json$/, "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < oldest) continue;
        try {
          const data = JSON.parse(await fs.readFile(this.#file(kind, day), "utf8"));
          if (kind === "digests") {
            this.digests.set(day, data);
            continue;
          }
          for (const a of data) {
            // Bài đang phân tích dở khi tắt ứng dụng sẽ được xếp hàng lại.
            if (a.status === "analyzing") a.status = "pending";
            this.articles.set(a.id, a);
            this.byUrl.set(a.url, a.id);
          }
        } catch (err) {
          this.log.warn(`Không đọc được ${kind}/${name}:`, err.message);
        }
      }
    }
    try {
      this.meta = { ...this.meta, ...JSON.parse(await fs.readFile(path.join(this.dir, "meta.json"), "utf8")) };
    } catch {
      /* lần chạy đầu tiên */
    }
    this.prune();
    return this;
  }

  has(url) {
    if (this.byUrl.has(url)) return true;
    const seen = this.meta.seen[url];
    return Boolean(seen && (!seen.retryAt || Date.parse(seen.retryAt) > Date.now()));
  }

  get(id) {
    return this.articles.get(id) || null;
  }

  add(article) {
    const day = vnDateKey(new Date(article.publishedAt || article.discoveredAt || this.now()));
    const record = { ...article, day };
    this.articles.set(record.id, record);
    this.byUrl.set(record.url, record.id);
    delete this.meta.seen[record.url];
    this.metaDirty = true;
    this.#touch(day);
    return record;
  }

  update(id, patch) {
    const a = this.articles.get(id);
    if (!a) return null;
    Object.assign(a, patch);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete a[k];
    this.#touch(a.day);
    return a;
  }

  markSeen(url, reason, retryAfterMs = 0) {
    this.meta.seen[url] = {
      at: new Date().toISOString(),
      reason,
      ...(retryAfterMs ? { retryAt: new Date(Date.now() + retryAfterMs).toISOString() } : {}),
    };
    this.metaDirty = true;
    this.scheduleSave();
  }

  /** Danh sách bài theo bộ lọc, mới nhất trước. */
  list({ date, category, sentiment, impact, q, includeNonEconomic = false } = {}) {
    const needle = q ? fold(q).trim() : "";
    const out = [];
    for (const a of this.articles.values()) {
      if (date && a.day !== date) continue;
      const an = a.analysis;
      if (!includeNonEconomic && an && an.is_economic_news === false) continue;
      if (category && an?.category !== category) continue;
      if (sentiment && an?.sentiment !== sentiment) continue;
      if (impact && an?.impact_level !== impact) continue;
      if (needle) {
        const hay = fold([a.title, a.description, an?.summary, an?.tickers?.join(" "), an?.sectors?.join(" ")].join(" "));
        if (!needle.split(/\s+/).every((w) => hay.includes(w))) continue;
      }
      out.push(a);
    }
    return out.sort((x, y) => timeOf(y) - timeOf(x));
  }

  /** Bài chờ phân tích, mới nhất trước. */
  pending() {
    return [...this.articles.values()].filter((a) => a.status === "pending").sort((x, y) => timeOf(y) - timeOf(x));
  }

  /** Bài đã phân tích của một ngày, ưu tiên tác động cao rồi mới nhất. */
  analyzedForDigest(day, limit) {
    return this.list({ date: day })
      .filter((a) => a.status === "done" && a.analysis)
      .sort((x, y) => (IMPACT_RANK[y.analysis.impact_level] || 0) - (IMPACT_RANK[x.analysis.impact_level] || 0) || timeOf(y) - timeOf(x))
      .slice(0, limit);
  }

  dates() {
    const map = new Map();
    for (const a of this.articles.values()) {
      if (a.analysis?.is_economic_news === false) continue;
      const d = map.get(a.day) || { date: a.day, total: 0, analyzed: 0 };
      d.total++;
      if (a.status === "done") d.analyzed++;
      map.set(a.day, d);
    }
    for (const day of this.digests.keys()) if (!map.has(day)) map.set(day, { date: day, total: 0, analyzed: 0 });
    return [...map.values()]
      .map((d) => ({ ...d, hasDigest: Boolean(this.digests.get(d.date)?.length) }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  counts() {
    const c = { total: this.articles.size, pending: 0, analyzing: 0, done: 0, error: 0, skipped: 0 };
    for (const a of this.articles.values()) c[a.status] = (c[a.status] || 0) + 1;
    return c;
  }

  addDigest(day, digest) {
    const versions = this.digests.get(day) || [];
    versions.push(digest);
    this.digests.set(day, versions.slice(-MAX_DIGEST_VERSIONS));
    this.dirtyDigests.add(day);
    this.scheduleSave();
  }

  latestDigest(day) {
    const versions = this.digests.get(day);
    return versions?.length ? versions[versions.length - 1] : null;
  }

  usage(day) {
    return this.meta.usage[day] || { input: 0, output: 0, analyses: 0, digests: 0 };
  }

  recordUsage(day, usage, kind) {
    const u = { ...this.usage(day) };
    u.input += usage?.input || 0;
    u.output += usage?.output || 0;
    if (kind === "analysis") u.analyses++;
    if (kind === "digest") u.digests++;
    this.meta.usage[day] = u;
    this.metaDirty = true;
    this.scheduleSave();
  }

  setLastCrawl(info) {
    this.meta.lastCrawl = info;
    this.metaDirty = true;
    this.scheduleSave();
  }

  prune() {
    const oldest = addDays(vnDateKey(this.now()), -this.retentionDays);
    for (const [id, a] of this.articles) {
      if (a.day < oldest) {
        this.articles.delete(id);
        this.byUrl.delete(a.url);
      }
    }
    for (const day of this.digests.keys()) if (day < oldest) this.digests.delete(day);
    for (const day of Object.keys(this.meta.usage)) if (day < oldest) delete this.meta.usage[day];
    const now = Date.now();
    for (const [url, s] of Object.entries(this.meta.seen)) {
      if (now - Date.parse(s.at) > SEEN_TTL_MS) delete this.meta.seen[url];
    }
    this.metaDirty = true;
    this.scheduleSave();
  }

  #touch(day) {
    this.dirtyDays.add(day);
    this.scheduleSave();
  }

  scheduleSave(delay = 1000) {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush().catch((err) => this.log.error("Lỗi ghi dữ liệu:", err.message));
    }, delay);
    this.saveTimer.unref?.();
  }

  /** Ghi các phần đã thay đổi xuống đĩa (ghi ra file tạm rồi đổi tên để tránh hỏng file). */
  flush() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const days = [...this.dirtyDays];
    const digestDays = [...this.dirtyDigests];
    const withMeta = this.metaDirty;
    const payloads = [
      ...days.map((day) => [
        this.#file("articles", day),
        [...this.articles.values()].filter((a) => a.day === day),
      ]),
      ...digestDays.map((day) => [this.#file("digests", day), this.digests.get(day) || []]),
      ...(withMeta ? [[path.join(this.dir, "meta.json"), this.meta]] : []),
    ].map(([file, data]) => [file, JSON.stringify(data)]);
    this.dirtyDays.clear();
    this.dirtyDigests.clear();
    this.metaDirty = false;

    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        for (const [file, json] of payloads) {
          const tmp = `${file}.${process.pid}.tmp`;
          await fs.writeFile(tmp, json);
          await fs.rename(tmp, file);
        }
      })
      .catch((err) => {
        // Đánh dấu lại để lần ghi sau thử lại.
        days.forEach((d) => this.dirtyDays.add(d));
        digestDays.forEach((d) => this.dirtyDigests.add(d));
        if (withMeta) this.metaDirty = true;
        throw err;
      });
    return this.writing;
  }
}
