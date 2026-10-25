// Máy chủ giả lập dùng cho kiểm thử đầu-cuối: một "24HMoney" thu nhỏ và API Anthropic (SSE).
import http from "node:http";
import { SAMPLE_ANALYSIS, sampleDigest } from "./helpers.js";

export function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

export const MOCK_ARTICLES = [
  { path: "/news/ngan-hang-nha-nuoc-giu-nguyen-lai-suat-c1a2000003.html", title: "Ngân hàng Nhà nước giữ nguyên lãi suất điều hành", hoursAgo: 1 },
  { path: "/news/vn-index-tang-manh-khoi-ngoai-mua-rong-c1a2000002.html", title: "VN-Index tăng mạnh, khối ngoại mua ròng", hoursAgo: 2 },
  { path: "/news/gia-vang-lap-dinh-moi-c1a2000001.html", title: "Giá vàng lập đỉnh mới", hoursAgo: 3 },
];

/** Trang tin giả lập: giờ đăng tính theo thời điểm hiện tại để kiểm thử chạy được vào ngày bất kỳ. */
export function mockSite() {
  const started = Date.now();
  return listen((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body, type = "text/html; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };
    if (url.pathname === "/robots.txt") return send(200, "User-agent: *\nDisallow:\n", "text/plain");
    if (url.pathname === "/") {
      const links = MOCK_ARTICLES.map((a) => `<li><a href="${a.path}">${a.title}</a></li>`).join("");
      return send(200, `<!doctype html><html lang="vi"><body><ul class="news">${links}</ul></body></html>`);
    }
    const article = MOCK_ARTICLES.find((a) => a.path === url.pathname);
    if (!article) return send(404, "Not found");
    const published = new Date(started - article.hoursAgo * 3600e3).toISOString();
    const body = Array.from(
      { length: 5 },
      (_, i) => `<p>Đoạn ${i + 1}: ${article.title}. Diễn biến được ghi nhận trong phiên giao dịch với nhiều số liệu đáng chú ý về lãi suất, tỷ giá và dòng vốn.</p>`,
    ).join("");
    return send(
      200,
      `<!doctype html><html lang="vi"><head><title>${article.title} - 24HMoney</title>
      <meta property="og:title" content="${article.title}"><meta property="og:description" content="Sapo: ${article.title}">
      <meta property="article:published_time" content="${published}"></head>
      <body><article><h1>${article.title}</h1><div class="content">${body}</div></article></body></html>`,
    );
  });
}

function sse(res, text) {
  const events = [
    ["message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1200, output_tokens: 1 } } }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ...[text.slice(0, 40), text.slice(40)].map((chunk) => ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: chunk } }]),
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 640 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.end();
}

/** API Anthropic giả lập: trả JSON đúng schema, ghi lại các request để kiểm tra. */
export function mockAnthropic() {
  const requests = [];
  return listen(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if (req.method !== "POST" || !req.url.startsWith("/v1/messages")) {
      res.writeHead(404).end();
      return;
    }
    const body = JSON.parse(raw);
    requests.push({ url: req.url, headers: req.headers, body });
    const isDigest = JSON.stringify(body.output_config?.format?.schema?.properties || {}).includes("market_mood");
    const ids = [...String(body.messages?.[0]?.content || "").matchAll(/\[(c1a\d+)\]/g)].map((m) => m[1]);
    sse(res, JSON.stringify(isDigest ? sampleDigest(ids) : SAMPLE_ANALYSIS));
  }).then((s) => ({ ...s, requests }));
}
