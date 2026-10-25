import { AiError, classifyError } from "./ai/analyst.js";
import { createLogger, mapLimit, vnClock, vnDateKey } from "./util.js";

const MAX_ATTEMPTS = 3;
const FATAL_RETRY_MS = 30 * 60e3;
const DIGEST_RETRY_MS = 15 * 60e3;

/**
 * Điều phối: quét tin định kỳ → xếp hàng phân tích AI → lập bản tin theo giờ cố định.
 */
export class Pipeline {
  constructor({ config, store, crawler, analyst, logger = createLogger("pipeline"), now = () => new Date() }) {
    this.cfg = config;
    this.store = store;
    this.crawler = crawler;
    this.analyst = config.ai.enabled ? analyst : null;
    this.log = logger;
    this.now = now;
    this.crawling = null;
    this.nextCrawlAt = null;
    this.ai = { running: 0, blocked: null, lastError: null };
    this.digesting = new Map();
    this.digestAttempts = new Map();
    this.timers = [];
  }

  start() {
    const every = Math.max(1, this.cfg.source.crawlIntervalMinutes) * 60e3;
    const loop = async () => {
      this.nextCrawlAt = new Date(Date.now() + every);
      await this.crawl().catch((err) => this.log.error("Lỗi khi quét tin:", err.message));
    };
    loop();
    this.timers.push(setInterval(loop, every));
    this.timers.push(setInterval(() => this.#digestTick(), 60e3));
    this.pumpAi();
  }

  stop() {
    this.timers.forEach(clearInterval);
    this.timers = [];
  }

  /** Quét 24HMoney một lượt; nếu đang quét thì trả về lượt đang chạy. */
  crawl() {
    if (!this.crawling) {
      this.crawling = this.#crawl().finally(() => {
        this.crawling = null;
      });
    }
    return this.crawling;
  }

  async #crawl() {
    const started = this.now();
    const { source } = this.cfg;
    this.log.info("Bắt đầu quét tin từ", source.baseUrl);
    if (this.ai.blocked && Date.now() - this.ai.blocked.atMs > FATAL_RETRY_MS) this.ai.blocked = null;

    const { items, errors, pages } = await this.crawler.discover();
    const fresh = items.filter((c) => !this.store.has(c.url)).slice(0, source.maxNewPerCrawl);
    const stats = { added: 0, old: 0, failed: 0 };
    const cutoff = started.getTime() - source.maxAgeHours * 3600e3;

    await mapLimit(fresh, source.concurrency, async (candidate) => {
      try {
        const article = await this.crawler.fetchArticle(candidate);
        if (!article.title) {
          this.store.markSeen(candidate.url, "empty");
          stats.failed++;
          return;
        }
        if (article.publishedAt && Date.parse(article.publishedAt) < cutoff) {
          this.store.markSeen(candidate.url, "old");
          stats.old++;
          return;
        }
        this.store.add({
          ...article,
          // Nội dung gốc chỉ giữ tạm để phân tích; khi tắt AI thì không lưu.
          content: this.analyst ? article.content : undefined,
          discoveredAt: started.toISOString(),
          fetchedAt: this.now().toISOString(),
          status: "pending",
          attempts: 0,
        });
        stats.added++;
      } catch (err) {
        this.store.markSeen(candidate.url, "error", 2 * 3600e3);
        stats.failed++;
        this.log.warn("Lỗi tải bài", candidate.url, "-", err.message);
      }
    });

    const info = {
      startedAt: started.toISOString(),
      finishedAt: this.now().toISOString(),
      pages,
      discovered: items.length,
      ...stats,
      errors: errors.slice(0, 5),
    };
    this.store.setLastCrawl(info);
    this.store.prune();
    this.log.info(
      `Quét xong: phát hiện ${items.length} link, thêm ${stats.added} bài mới, bỏ qua ${stats.old} bài cũ, lỗi ${stats.failed}.`,
    );
    this.pumpAi();
    return info;
  }

  // ---------- Phân tích AI ----------

  pumpAi() {
    if (!this.analyst || this.ai.blocked) return;
    while (this.ai.running < this.cfg.ai.concurrency) {
      const next = this.#nextForAnalysis();
      if (!next) break;
      this.ai.running++;
      this.store.update(next.id, { status: "analyzing" });
      this.#analyze(next).finally(() => {
        this.ai.running--;
        this.pumpAi();
      });
    }
  }

  #nextForAnalysis() {
    const now = this.now();
    // Tính cả các bài đang phân tích dở để không vượt giới hạn khi chạy song song.
    if (this.store.usage(vnDateKey(now)).analyses + this.ai.running >= this.cfg.ai.dailyLimit) return null;
    const minTime = now.getTime() - this.cfg.ai.autoAnalyzeMaxAgeHours * 3600e3;
    return (
      this.store.pending().find((a) => {
        if (a.nextAttemptAt && Date.parse(a.nextAttemptAt) > now.getTime()) return false;
        return Date.parse(a.publishedAt || a.discoveredAt) >= minTime;
      }) || null
    );
  }

  async #analyze(article) {
    const id = article.id;
    try {
      let current = this.store.get(id);
      if (!current.content || current.content.length < 200) {
        // Nội dung đã được dọn sau lần phân tích trước (hoặc quá ngắn): tải lại bài gốc.
        try {
          const fresh = await this.crawler.fetchArticle({ url: current.url });
          if (fresh.content) current = this.store.update(id, { content: fresh.content });
        } catch (err) {
          if (!current.description) throw new AiError(`Không tải lại được bài viết: ${err.message}`, { code: "fetch", retryable: true });
        }
      }
      const result = await this.analyst.analyzeArticle(current, this.now());
      this.store.update(id, {
        status: "done",
        analysis: result.analysis,
        model: result.model,
        analyzedAt: this.now().toISOString(),
        content: undefined,
        error: undefined,
        nextAttemptAt: undefined,
      });
      this.store.recordUsage(vnDateKey(this.now()), result.usage, "analysis");
      this.ai.lastError = null;
    } catch (raw) {
      const err = classifyError(raw);
      this.ai.lastError = { message: err.message, code: err.code, at: this.now().toISOString() };
      if (err.fatal) {
        this.ai.blocked = { message: err.message, code: err.code, at: this.now().toISOString(), atMs: Date.now() };
        this.store.update(id, { status: "pending" });
        this.log.error("Tạm dừng phân tích AI:", err.message);
        return;
      }
      const attempts = (this.store.get(id)?.attempts || 0) + 1;
      const retry = err.retryable && attempts < MAX_ATTEMPTS;
      this.store.update(id, {
        status: retry ? "pending" : "error",
        attempts,
        error: err.message,
        nextAttemptAt: retry ? new Date(this.now().getTime() + attempts * 10 * 60e3).toISOString() : undefined,
      });
      this.log.warn(`Phân tích bài ${id} thất bại (lần ${attempts}):`, err.message);
    }
  }

  /** Phân tích (lại) một bài theo yêu cầu người dùng, bỏ qua giới hạn tự động. */
  async analyzeNow(id) {
    const article = this.store.get(id);
    if (!article) return null;
    if (!this.analyst) throw new AiError("Tính năng AI đang tắt (AI_ENABLED=0).", { code: "config" });
    if (article.status === "analyzing") return article;
    this.ai.blocked = null;
    this.store.update(id, { status: "analyzing", attempts: 0 });
    this.ai.running++;
    try {
      await this.#analyze(article);
    } finally {
      this.ai.running--;
    }
    const updated = this.store.get(id);
    if (updated.status !== "done") throw new AiError(updated.error || this.ai.lastError?.message || "Phân tích thất bại.");
    this.pumpAi();
    return updated;
  }

  // ---------- Bản tin tổng hợp ----------

  async generateDigest(day, { manual = false } = {}) {
    if (!this.analyst) throw new AiError("Tính năng AI đang tắt (AI_ENABLED=0).", { code: "config" });
    if (this.digesting.has(day)) return this.digesting.get(day);
    const articles = this.store.analyzedForDigest(day, this.cfg.digest.maxArticles);
    const min = manual ? 1 : this.cfg.digest.minArticles;
    if (articles.length < min) {
      throw new AiError(`Chưa đủ tin đã phân tích để lập bản tin (có ${articles.length}, cần ít nhất ${min}).`, {
        code: "not_enough",
      });
    }
    const job = (async () => {
      if (manual) this.ai.blocked = null;
      try {
        const result = await this.analyst.writeDigest(day, articles, this.now());
        const digest = {
          ...result.digest,
          date: day,
          createdAt: this.now().toISOString(),
          model: result.model,
          articleCount: articles.length,
        };
        this.store.addDigest(day, digest);
        this.store.recordUsage(vnDateKey(this.now()), result.usage, "digest");
        this.log.info(`Đã lập bản tin ngày ${day} từ ${articles.length} tin.`);
        return digest;
      } catch (raw) {
        const err = classifyError(raw);
        this.ai.lastError = { message: err.message, code: err.code, at: this.now().toISOString() };
        if (err.fatal) this.ai.blocked = { message: err.message, code: err.code, at: this.now().toISOString(), atMs: Date.now() };
        throw err;
      }
    })().finally(() => this.digesting.delete(day));
    this.digesting.set(day, job);
    return job;
  }

  /** Mỗi phút kiểm tra: đã tới mốc giờ lập bản tin mà bản tin hiện có cũ hơn mốc đó thì lập mới. */
  #digestTick() {
    if (!this.analyst || this.ai.blocked) return;
    const now = this.now();
    const day = vnDateKey(now);
    const clock = vnClock(now);
    const slot = [...this.cfg.digest.times].sort().filter((t) => t <= clock).pop();
    if (!slot) return;
    const slotTime = Date.parse(`${day}T${slot}:00+07:00`);
    const latest = this.store.latestDigest(day);
    if (latest && Date.parse(latest.createdAt) >= slotTime) return;
    const lastTry = this.digestAttempts.get(day) || 0;
    if (Date.now() - lastTry < DIGEST_RETRY_MS) return;
    // Không lập lại nếu không có tin mới kể từ bản tin trước.
    const analyzed = this.store.analyzedForDigest(day, Infinity);
    if (latest && !analyzed.some((a) => Date.parse(a.analyzedAt) > Date.parse(latest.createdAt))) return;
    this.digestAttempts.set(day, Date.now());
    this.generateDigest(day).catch((err) => {
      if (err.code !== "not_enough") this.log.warn("Không lập được bản tin:", err.message);
    });
  }

  status() {
    const now = this.now();
    const day = vnDateKey(now);
    return {
      now: now.toISOString(),
      source: this.cfg.source.baseUrl,
      crawling: Boolean(this.crawling),
      lastCrawl: this.store.meta.lastCrawl,
      nextCrawlAt: this.nextCrawlAt?.toISOString() || null,
      counts: this.store.counts(),
      ai: {
        enabled: Boolean(this.analyst),
        model: this.cfg.ai.model,
        running: this.ai.running,
        blocked: this.ai.blocked ? { message: this.ai.blocked.message, code: this.ai.blocked.code, at: this.ai.blocked.at } : null,
        lastError: this.ai.lastError,
        dailyLimit: this.cfg.ai.dailyLimit,
        usageToday: this.store.usage(day),
      },
      digest: { times: this.cfg.digest.times, generating: [...this.digesting.keys()] },
    };
  }
}
