// Điểm khởi động ứng dụng điện thoại: chạy toàn bộ quy trình (quét tin, phân tích, bản tin)
// ngay trên máy, rồi nạp giao diện dùng chung với bản web.
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";
import { Browser } from "@capacitor/browser";
import Anthropic from "@anthropic-ai/sdk";
import { buildConfig } from "../../src/config-core.js";
import { Store } from "../../src/store.js";
import { Crawler } from "../../src/crawler/index.js";
import { Analyst } from "../../src/ai/analyst.js";
import { Pipeline } from "../../src/pipeline.js";
import { handleApi } from "../../src/api.js";
import { IdbBackend } from "./idb-backend.js";

const SETTINGS_KEY = "money-insight-settings";
const MODELS = [
  { id: "claude-opus-5-5", label: "Opus 5.5 (sâu nhất)" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5 (cân bằng)" },
  { id: "claude-haiku-5-5", label: "Haiku 5.5 (tiết kiệm)" },
];
const DEFAULTS = { apiKey: "", model: "claude-opus-5-5", dailyLimit: 60, crawlInterval: 30 };

const clamp = (value, min, max, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function sanitize(input, base) {
  return {
    apiKey: String(input.apiKey ?? base.apiKey).trim(),
    model: MODELS.some((m) => m.id === input.model) ? input.model : base.model,
    dailyLimit: clamp(input.dailyLimit, 1, 500, base.dailyLimit),
    crawlInterval: clamp(input.crawlInterval, 10, 240, base.crawlInterval),
  };
}

async function readSettings() {
  try {
    const { value } = await Preferences.get({ key: SETTINGS_KEY });
    return sanitize(value ? JSON.parse(value) : {}, DEFAULTS);
  } catch {
    return { ...DEFAULTS };
  }
}

// Chỉ dùng khi kiểm thử trên trình duyệt: trỏ nguồn tin/API tới máy chủ giả lập.
const testEnv = window.MONEY_INSIGHT_TEST_ENV || {};

function createRuntime(settings, store) {
  const config = buildConfig({
    ...testEnv,
    CLAUDE_MODEL: settings.model,
    AI_DAILY_ARTICLE_LIMIT: String(settings.dailyLimit),
    CRAWL_INTERVAL_MINUTES: String(settings.crawlInterval),
    RETENTION_DAYS: "14",
    MAX_NEW_ARTICLES_PER_CRAWL: "30",
  });
  // API key do người dùng nhập, chỉ lưu trên máy; request đi qua lớp HTTP gốc của Capacitor.
  const analyst = settings.apiKey
    ? new Analyst(config.ai, {
        client: new Anthropic({
          apiKey: settings.apiKey,
          baseURL: testEnv.ANTHROPIC_BASE_URL,
          dangerouslyAllowBrowser: true,
          maxRetries: 3,
          timeout: 10 * 60e3,
        }),
      })
    : null;
  const pipeline = new Pipeline({ config, store, crawler: new Crawler(config.source), analyst });
  return { config, pipeline };
}

async function boot() {
  let settings = await readSettings();
  const store = await new Store(new IdbBackend(), { retentionDays: 14 }).load();
  let runtime = createRuntime(settings, store);
  runtime.pipeline.start();

  window.MoneyInsightLocal = {
    models: MODELS,
    native: Capacitor.isNativePlatform(),
    needsSetup: () => !settings.apiKey,
    getSettings: () => ({ ...settings }),
    async saveSettings(next) {
      settings = sanitize(next, settings);
      await Preferences.set({ key: SETTINGS_KEY, value: JSON.stringify(settings) });
      runtime.pipeline.stop();
      runtime = createRuntime(settings, store);
      runtime.pipeline.start();
    },
    async request(path, { method = "GET", body } = {}) {
      const url = new URL(path, "https://app.local");
      return handleApi(
        { config: runtime.config, store, pipeline: runtime.pipeline },
        {
          method,
          path: url.pathname.replace(/^\/api/, ""),
          query: Object.fromEntries(url.searchParams),
          body: body ? JSON.parse(body) : {},
        },
      );
    },
    openExternal(url) {
      if (Capacitor.isNativePlatform()) return Browser.open({ url });
      window.open(url, "_blank", "noopener");
    },
  };

  window.addEventListener("pagehide", () => store.flush().catch(() => {}));
  // Ứng dụng chỉ chạy khi đang mở: quay lại app thì cập nhật nếu đã quá chu kỳ; rời app thì lưu ngay.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      store.flush().catch(() => {});
      return;
    }
    const last = Date.parse(store.meta.lastCrawl?.finishedAt || 0) || 0;
    if (Date.now() - last > runtime.config.source.crawlIntervalMinutes * 60e3) {
      runtime.pipeline.crawl().catch(() => {});
    }
  });
}

boot()
  .then(() => import("../../public/app.js"))
  .catch((err) => {
    document.getElementById("view").textContent = `Không khởi động được ứng dụng: ${err.message}`;
  });
