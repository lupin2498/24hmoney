import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Đọc file .env (nếu có) mà không cần thêm thư viện dotenv.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : fallback;
};
const list = (value, fallback) =>
  value ? value.split(",").map((s) => s.trim()).filter(Boolean) : fallback;
// Chuẩn hoá mốc giờ "8:00" → "08:00", bỏ giá trị sai.
const clockTimes = (values) =>
  values
    .map((t) => t.match(/^(\d{1,2}):(\d{2})$/))
    .filter((m) => m && Number(m[1]) < 24 && Number(m[2]) < 60)
    .map((m) => `${m[1].padStart(2, "0")}:${m[2]}`);
const effort = (value, fallback) => (["low", "medium", "high", "xhigh", "max"].includes(value) ? value : fallback);
const bool = (value, fallback) =>
  value === undefined || value === "" ? fallback : !["0", "false", "no", "off"].includes(value.toLowerCase());

export function loadConfig(env = process.env) {
  const baseUrl = (env.SOURCE_BASE_URL || "https://24hmoney.vn").replace(/\/+$/, "");
  return {
    port: int(env.PORT, 3000),
    host: env.HOST || "0.0.0.0",
    dataDir: path.resolve(ROOT, env.DATA_DIR || "data"),
    adminToken: env.ADMIN_TOKEN || "",
    retentionDays: int(env.RETENTION_DAYS, 30),
    source: {
      baseUrl,
      // Các trang danh sách tin dùng để phát hiện bài mới (đường dẫn tương đối hoặc URL đầy đủ).
      seedPages: list(env.SOURCE_PAGES, ["/", "/indices/vn-index/tin-tuc"]),
      // Mẫu đường dẫn của bài viết tin tức trên 24HMoney, ví dụ /news/ten-bai-viet-c1a418401.html
      articlePath: env.ARTICLE_PATH_PATTERN || "/news/[a-z0-9][a-z0-9-]*\\.html",
      // Mẫu đường dẫn của các trang chuyên mục tin được tự phát hiện từ menu trang chủ.
      listingPath: env.LISTING_PATH_PATTERN || "/(?:tin-tuc|news-category|chuyen-muc)(?:/[a-z0-9-]*)?",
      maxListingPages: int(env.MAX_LISTING_PAGES, 8),
      useSitemaps: bool(env.USE_SITEMAPS, true),
      crawlIntervalMinutes: int(env.CRAWL_INTERVAL_MINUTES, 20),
      maxNewPerCrawl: int(env.MAX_NEW_ARTICLES_PER_CRAWL, 40),
      maxAgeHours: int(env.MAX_ARTICLE_AGE_HOURS, 48),
      concurrency: int(env.CRAWL_CONCURRENCY, 3),
      delayMs: int(env.CRAWL_DELAY_MS, 300),
      timeoutMs: int(env.HTTP_TIMEOUT_MS, 20000),
      userAgent:
        env.CRAWL_USER_AGENT ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    },
    ai: {
      enabled: bool(env.AI_ENABLED, true),
      model: env.CLAUDE_MODEL || "claude-opus-5-5",
      articleEffort: effort(env.ARTICLE_EFFORT, "medium"),
      digestEffort: effort(env.DIGEST_EFFORT, "high"),
      fallbacks: bool(env.CLAUDE_FALLBACKS, true),
      concurrency: Math.max(1, int(env.AI_CONCURRENCY, 2)),
      dailyLimit: int(env.AI_DAILY_ARTICLE_LIMIT, 150),
      autoAnalyzeMaxAgeHours: int(env.AUTO_ANALYZE_MAX_AGE_HOURS, 36),
      maxArticleChars: int(env.AI_MAX_ARTICLE_CHARS, 24000),
    },
    digest: {
      times: clockTimes(list(env.DIGEST_TIMES, ["08:00", "12:00", "16:00", "20:00"])),
      minArticles: int(env.DIGEST_MIN_ARTICLES, 5),
      maxArticles: int(env.DIGEST_MAX_ARTICLES, 120),
    },
  };
}
