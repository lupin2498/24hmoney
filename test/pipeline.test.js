import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import { Pipeline } from "../src/pipeline.js";
import { AiError } from "../src/ai/analyst.js";
import { createApp } from "../src/server.js";
import { SAMPLE_ANALYSIS } from "./helpers.js";

const NOW = new Date("2026-10-25T05:00:00Z"); // 12:00 giờ Việt Nam
const quiet = { info() {}, warn() {}, error() {} };

const DIGEST = {
  headline: "Lãi suất ổn định",
  overview: "Tổng quan.",
  market_mood: "tich_cuc",
  mood_explanation: "Giải thích.",
  themes: [{ title: "Tiền tệ", analysis: "Phân tích.", article_ids: ["c1a3"] }],
  macro_view: "Vĩ mô.",
  sectors: [{ name: "Ngân hàng", outlook: "tich_cuc", reason: "Lý do." }],
  opportunities: ["Cơ hội"],
  risks: ["Rủi ro"],
  strategy: "Chiến lược.",
  watchlist: ["CPI"],
};

function makeArticle(seq, hoursAgo) {
  return {
    id: `c1a${seq}`,
    url: `https://24hmoney.vn/news/tin-${seq}-c1a${seq}.html`,
    title: `Tin số ${seq}`,
    description: `Sapo ${seq}`,
    publishedAt: new Date(NOW.getTime() - hoursAgo * 3600e3).toISOString(),
    dateSource: "metadata",
    content: `Nội dung chi tiết của tin ${seq}. `.repeat(20),
  };
}

class FakeCrawler {
  constructor(articles) {
    this.articles = new Map(articles.map((a) => [a.url, a]));
    this.fetched = [];
  }
  async discover() {
    return { items: [...this.articles.values()].map((a) => ({ url: a.url, id: a.id })), errors: [], pages: 1 };
  }
  async fetchArticle({ url }) {
    this.fetched.push(url);
    const a = this.articles.get(url);
    if (!a) throw new Error("404");
    if (a.fail) throw new Error("Lỗi mạng");
    return { ...a };
  }
}

class FakeAnalyst {
  constructor() {
    this.analyzed = [];
    this.error = null;
  }
  async analyzeArticle(article) {
    if (this.error) throw this.error;
    this.analyzed.push(article.id);
    return { analysis: { ...SAMPLE_ANALYSIS, tickers: ["VCB"] }, model: "claude-opus-5-5", usage: { input: 100, output: 50 } };
  }
  async writeDigest(day, articles) {
    this.digestInput = articles;
    return { digest: structuredClone(DIGEST), model: "claude-opus-5-5", usage: { input: 300, output: 200 } };
  }
}

async function setup({ env = {}, articles } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "money-insight-"));
  const config = loadConfig({ DATA_DIR: dir, ...env });
  const store = await new Store(dir, { logger: quiet, now: () => NOW }).load();
  const crawler = new FakeCrawler(articles || [makeArticle(3, 1), makeArticle(2, 2), makeArticle(1, 80)]);
  const analyst = new FakeAnalyst();
  const pipeline = new Pipeline({ config, store, crawler, analyst, logger: quiet, now: () => NOW });
  return { dir, config, store, crawler, analyst, pipeline };
}

async function idle(pipeline) {
  for (let i = 0; i < 200 && pipeline.ai.running > 0; i++) await new Promise((r) => setTimeout(r, 5));
}

test("quét tin → lưu bài mới, bỏ bài cũ → phân tích → dọn nội dung gốc", async () => {
  const { store, crawler, analyst, pipeline, dir } = await setup();
  const info = await pipeline.crawl();
  assert.equal(info.added, 2);
  assert.equal(info.old, 1);
  await idle(pipeline);

  assert.deepEqual(analyst.analyzed.sort(), ["c1a2", "c1a3"]);
  const a = store.get("c1a3");
  assert.equal(a.status, "done");
  assert.equal(a.day, "2026-10-25");
  assert.equal(a.content, undefined, "không giữ nội dung gốc sau khi phân tích");
  assert.equal(store.usage("2026-10-25").analyses, 2);
  assert.equal(store.usage("2026-10-25").input, 200);

  // Lượt quét sau không tải lại bài đã có hoặc đã bỏ qua.
  crawler.fetched = [];
  const again = await pipeline.crawl();
  assert.equal(again.added, 0);
  assert.deepEqual(crawler.fetched, []);

  // Dữ liệu được ghi xuống đĩa và đọc lại được.
  await store.flush();
  const reloaded = await new Store(dir, { logger: quiet, now: () => NOW }).load();
  assert.equal(reloaded.get("c1a3").analysis.category, "Vĩ mô");
  assert.equal(reloaded.has("https://24hmoney.vn/news/tin-1-c1a1.html"), true);
});

test("tôn trọng giới hạn phân tích mỗi ngày", async () => {
  const { store, analyst, pipeline } = await setup({ env: { AI_DAILY_ARTICLE_LIMIT: "1" } });
  await pipeline.crawl();
  await idle(pipeline);
  assert.equal(analyst.analyzed.length, 1);
  assert.equal(store.counts().pending, 1);
});

test("lỗi cấu hình AI tạm dừng hàng đợi, phân tích thủ công vẫn thử lại", async () => {
  const { store, analyst, pipeline } = await setup();
  analyst.error = new AiError("Chưa cấu hình hoặc sai ANTHROPIC_API_KEY.", { code: "auth", fatal: true });
  await pipeline.crawl();
  await idle(pipeline);
  assert.equal(pipeline.status().ai.blocked.code, "auth");
  assert.equal(store.counts().pending, 2);

  analyst.error = null;
  const done = await pipeline.analyzeNow("c1a2");
  assert.equal(done.status, "done");
  assert.equal(pipeline.status().ai.blocked, null);
});

test("lỗi tạm thời được thử lại, quá số lần thì đánh dấu lỗi", async () => {
  const { store, analyst, pipeline } = await setup({ articles: [makeArticle(5, 1)] });
  analyst.error = new AiError("API quá tải", { code: "unavailable", retryable: true });
  await pipeline.crawl();
  await idle(pipeline);
  const a = store.get("c1a5");
  assert.equal(a.status, "pending");
  assert.equal(a.attempts, 1);
  assert.ok(Date.parse(a.nextAttemptAt) > NOW.getTime());
  await assert.rejects(pipeline.analyzeNow("c1a5"), /API quá tải/);
});

test("lập bản tin ngày", async () => {
  const { store, analyst, pipeline } = await setup();
  await pipeline.crawl();
  await idle(pipeline);
  await assert.rejects(pipeline.generateDigest("2026-10-25"), (e) => e.code === "not_enough");
  const digest = await pipeline.generateDigest("2026-10-25", { manual: true });
  assert.equal(digest.headline, "Lãi suất ổn định");
  assert.equal(digest.articleCount, 2);
  assert.equal(store.latestDigest("2026-10-25").createdAt, NOW.toISOString());
  assert.equal(analyst.digestInput.length, 2);
  assert.equal(store.dates()[0].hasDigest, true);
});

test("API: đọc dữ liệu công khai, thao tác cần mã quản trị", async () => {
  const { config, store, pipeline } = await setup({ env: { ADMIN_TOKEN: "bi-mat" } });
  await pipeline.crawl();
  await idle(pipeline);
  const app = createApp({ config, store, pipeline });
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.adminRequired, true);
    assert.equal(status.counts.done, 2);

    const list = await (await fetch(`${base}/api/articles?date=2026-10-25&q=tin so 3`)).json();
    assert.equal(list.total, 1);
    assert.equal(list.items[0].id, "c1a3");
    assert.equal(list.items[0].content, undefined);

    assert.equal((await fetch(`${base}/api/articles?date=25-10-2026`)).status, 400);
    assert.equal((await fetch(`${base}/api/articles/khong-co`)).status, 404);

    const denied = await fetch(`${base}/api/digest`, { method: "POST" });
    assert.equal(denied.status, 401);
    const ok = await fetch(`${base}/api/digest`, {
      method: "POST",
      headers: { Authorization: "Bearer bi-mat", "Content-Type": "application/json" },
      body: JSON.stringify({ date: "2026-10-25" }),
    });
    assert.equal(ok.status, 200);
    const digest = await (await fetch(`${base}/api/digest?date=2026-10-25`)).json();
    assert.equal(digest.digest.headline, "Lãi suất ổn định");

    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
  } finally {
    server.close();
  }
});
