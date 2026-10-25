import { sleep } from "../util.js";

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} khi tải ${url}`);
    this.status = status;
    this.url = url;
  }
}

const RETRYABLE = (status) => status === 429 || status >= 500;

/**
 * HTTP client lịch sự: giới hạn số request song song, giãn cách giữa các request,
 * thử lại khi gặp lỗi mạng/429/5xx và giới hạn dung lượng tải về.
 */
export class HttpClient {
  constructor({ userAgent, timeoutMs = 20000, delayMs = 300, concurrency = 3, retries = 2, fetchImpl } = {}) {
    this.userAgent = userAgent;
    this.timeoutMs = timeoutMs;
    this.delayMs = delayMs;
    this.concurrency = Math.max(1, concurrency);
    this.retries = retries;
    this.fetch = fetchImpl || globalThis.fetch;
    this.active = 0;
    this.waiting = [];
    this.nextStart = 0;
  }

  async #acquire() {
    if (this.active >= this.concurrency) await new Promise((resolve) => this.waiting.push(resolve));
    this.active++;
    // Giãn cách thời điểm bắt đầu các request để không dồn dập vào máy chủ nguồn.
    const now = Date.now();
    const wait = Math.max(0, this.nextStart - now);
    this.nextStart = Math.max(now, this.nextStart) + this.delayMs;
    if (wait) await sleep(wait);
  }

  #release() {
    this.active--;
    this.waiting.shift()?.();
  }

  async getText(url, { accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", maxBytes = 8e6 } = {}) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt) await sleep(1000 * 3 ** (attempt - 1));
      await this.#acquire();
      try {
        const res = await this.fetch(url, {
          headers: {
            "User-Agent": this.userAgent,
            Accept: accept,
            "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.6",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!res.ok) {
          lastError = new HttpError(res.status, url);
          await res.body?.cancel().catch(() => {});
          if (RETRYABLE(res.status)) continue;
          throw lastError;
        }
        const text = await readLimited(res, maxBytes);
        return { url: res.url || url, status: res.status, contentType: res.headers.get("content-type") || "", text };
      } catch (err) {
        if ((err instanceof HttpError && !RETRYABLE(err.status)) || err.code === "TOO_LARGE") throw err;
        lastError = err;
      } finally {
        this.#release();
      }
    }
    throw lastError;
  }
}

async function readLimited(res, maxBytes) {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw Object.assign(new Error(`Phản hồi vượt quá ${Math.round(maxBytes / 1e6)} MB: ${res.url}`), { code: "TOO_LARGE" });
    }
    out += decoder.decode(value, { stream: true });
  }
  return out + decoder.decode();
}
