// Kiểm thử đầu-cuối: chạy ứng dụng thật (node src/index.js) với trang tin và API Anthropic giả lập.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MOCK_ARTICLES, mockAnthropic, mockSite } from "./mock-servers.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

async function waitFor(fn, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch {
      /* ứng dụng chưa sẵn sàng */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Hết thời gian chờ");
}

test("quét → phân tích → lập bản tin qua ứng dụng thật", { timeout: 60000 }, async () => {
  const site = await mockSite();
  const api = await mockAnthropic();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "money-insight-e2e-"));
  const port = await freePort();
  const app = spawn(process.execPath, ["src/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      DATA_DIR: dataDir,
      SOURCE_BASE_URL: site.origin,
      SOURCE_PAGES: "/",
      CRAWL_DELAY_MS: "0",
      ANTHROPIC_API_KEY: "test-key",
      ANTHROPIC_BASE_URL: api.origin,
      ADMIN_TOKEN: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  app.stdout.on("data", (d) => (logs += d));
  app.stderr.on("data", (d) => (logs += d));
  const base = `http://127.0.0.1:${port}`;

  try {
    const status = await waitFor(async () => {
      const s = await (await fetch(`${base}/api/status`)).json();
      return s.counts.done === MOCK_ARTICLES.length ? s : null;
    });
    assert.equal(status.lastCrawl.added, MOCK_ARTICLES.length);
    assert.equal(status.ai.usageToday.analyses, MOCK_ARTICLES.length);

    const list = await (await fetch(`${base}/api/articles?date=${status.today}`)).json();
    assert.equal(list.total, MOCK_ARTICLES.length);
    assert.deepEqual(
      list.items.map((a) => a.id),
      ["c1a2000003", "c1a2000002", "c1a2000001"],
    );
    assert.equal(list.items[0].analysis.category, "Vĩ mô");

    const res = await fetch(`${base}/api/digest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: status.today }),
    });
    assert.equal(res.status, 200);
    const { digest } = await res.json();
    assert.equal(digest.articleCount, MOCK_ARTICLES.length);
    assert.equal(digest.themes[0].article_ids.length, MOCK_ARTICLES.length);

    // Request gửi tới API Anthropic đúng định dạng.
    assert.equal(api.requests.length, MOCK_ARTICLES.length + 1);
    for (const r of api.requests) {
      assert.equal(r.headers["x-api-key"] || r.headers.authorization?.replace(/^Bearer /, ""), "test-key");
      assert.match(r.headers["anthropic-beta"], /server-side-fallback-2026-07-01/);
      assert.equal(r.body.model, "claude-opus-5-5");
      assert.equal(r.body.stream, true);
      assert.equal(r.body.fallbacks, "default");
      assert.equal(r.body.output_config.format.type, "json_schema");
    }
    const article = api.requests.find((r) => r.body.messages[0].content.includes("<bai_viet>"));
    assert.match(article.body.messages[0].content, /Đoạn 1: /);

    const page = await fetch(`${base}/`);
    assert.match(await page.text(), /Money Insight/);
  } catch (err) {
    err.message += `\n--- log ứng dụng ---\n${logs}`;
    throw err;
  } finally {
    app.kill("SIGTERM");
    await new Promise((r) => app.once("exit", r));
    site.server.close();
    api.server.close();
  }

  const saved = await fs.readdir(path.join(dataDir, "articles"));
  assert.equal(saved.length >= 1, true, "dữ liệu được lưu khi dừng ứng dụng");
  await fs.rm(dataDir, { recursive: true, force: true });
});
