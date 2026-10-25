// Việt Nam dùng UTC+7 quanh năm (không có giờ mùa hè) nên có thể cộng lệch cố định.
const VN_OFFSET_MS = 7 * 3600 * 1000;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ngày theo giờ Việt Nam dạng YYYY-MM-DD. */
export function vnDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return new Date(d.getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/** Giờ:phút hiện tại theo giờ Việt Nam, dạng HH:MM. */
export function vnClock(date = new Date()) {
  return new Date(date.getTime() + VN_OFFSET_MS).toISOString().slice(11, 16);
}

/** Tạo Date từ các thành phần ngày giờ theo giờ Việt Nam. */
export function vnDate(year, month, day, hour = 0, minute = 0) {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - VN_OFFSET_MS);
}

export function formatVnDateTime(date) {
  if (!date) return "";
  const d = new Date(new Date(date).getTime() + VN_OFFSET_MS);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

export function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const isDateKey = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export function cleanText(text) {
  return String(text ?? "")
    .replace(/ /g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Chạy fn trên từng phần tử với số lượng song song tối đa là limit. */
export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

const VALID = (y, mo, d, h, mi) =>
  y >= 2000 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && h >= 0 && h <= 23 && mi >= 0 && mi <= 59;

/**
 * Tìm thời điểm đăng bài trong một đoạn văn bản tiếng Việt, ví dụ:
 * "21/10/2026 14:35", "14:35 21/10/2026", "Thứ hai, 21/10/2026 - 14:35 (GMT+7)",
 * "5 phút trước", "2 giờ trước". Trả về Date hoặc null.
 */
export function parseVietnameseDateTime(text, now = new Date()) {
  if (!text) return null;
  const s = String(text);

  const dateRe = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/g;
  let m;
  while ((m = dateRe.exec(s))) {
    const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const before = s.slice(Math.max(0, m.index - 16), m.index);
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 16);
    const timeAfter = after.match(/^\D{0,8}?(\d{1,2})[:hH](\d{2})/);
    const timeBefore = before.match(/(\d{1,2})[:hH](\d{2})\D{0,8}$/);
    const t = timeAfter || timeBefore;
    const hour = t ? Number(t[1]) : 0;
    const minute = t ? Number(t[2]) : 0;
    if (VALID(year, month, day, hour, minute)) return vnDate(year, month, day, hour, minute);
  }

  const rel = s.match(/(\d+)\s*(giây|phút|giờ|tiếng|ngày)\s*trước/i);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2].toLowerCase();
    const ms = { giây: 1e3, phút: 6e4, giờ: 3.6e6, tiếng: 3.6e6, ngày: 8.64e7 }[unit];
    return new Date(now.getTime() - n * ms);
  }
  return null;
}

export function createLogger(scope) {
  const stamp = () => new Date().toISOString();
  return {
    info: (...a) => console.log(stamp(), `[${scope}]`, ...a),
    warn: (...a) => console.warn(stamp(), `[${scope}]`, ...a),
    error: (...a) => console.error(stamp(), `[${scope}]`, ...a),
  };
}
