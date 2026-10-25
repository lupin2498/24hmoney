import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { cleanText, parseVietnameseDateTime } from "../util.js";
import { articleIdFromUrl, toDate } from "./discover.js";

const ARTICLE_TYPES = /^(NewsArticle|Article|ReportageNewsArticle|AnalysisNewsArticle|BlogPosting|WebPage)$/i;

function readJsonLd(doc) {
  const found = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(visit);
    const types = [].concat(node["@type"] || []);
    if (types.some((t) => ARTICLE_TYPES.test(String(t)))) found.push(node);
    if (node["@graph"]) visit(node["@graph"]);
  };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      visit(JSON.parse(s.textContent));
    } catch {
      /* JSON-LD lỗi thì bỏ qua */
    }
  }
  // Ưu tiên đối tượng bài báo thật sự (có headline) hơn WebPage chung chung.
  return found.find((n) => n.headline && !/^WebPage$/i.test(String(n["@type"]))) || found.find((n) => n.headline) || null;
}

const nameOf = (v) => (Array.isArray(v) ? nameOf(v[0]) : typeof v === "string" ? v : v?.name || "");
const imageOf = (v) => (Array.isArray(v) ? imageOf(v[0]) : typeof v === "string" ? v : v?.url || "");

export function cleanTitle(title) {
  return cleanText(title)
    .replace(/\s+/g, " ")
    .replace(/\s*[-|–—:]\s*24\s*H\s*Money\b.*$/i, "")
    .trim();
}

function htmlToText(document, html) {
  const box = document.createElement("div");
  box.innerHTML = html;
  box.querySelectorAll("script,style,noscript,iframe,svg,button,form").forEach((el) => el.remove());
  box.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  box.querySelectorAll("li").forEach((li) => li.prepend("- "));
  box
    .querySelectorAll("p,div,h1,h2,h3,h4,h5,h6,li,tr,blockquote,section,article,table,ul,ol,figure,figcaption")
    .forEach((el) => el.append("\n\n"));
  return cleanText(box.textContent);
}

function findSourceName(content) {
  const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(-3).reverse()) {
    const m = line.match(/^(?:\(?\s*)(?:Nguồn|Theo)\s*:?\s*([^()\n]{2,50}?)\s*\)?\.?$/i);
    if (m && !/^(đó|như|ông|bà|anh|chị|các|những|số liệu|báo cáo|thống kê)\b/i.test(m[1])) return m[1].trim();
  }
  return "";
}

/** Thẻ <time datetime> nằm cùng khối với tiêu đề bài viết. */
function timeNearHeading(doc) {
  let el = doc.querySelector("h1")?.parentElement;
  for (let i = 0; el && i < 3; i++, el = el.parentElement) {
    const t = el.querySelector("time[datetime]");
    if (t) return t.getAttribute("datetime");
  }
  return doc.querySelector("article time[datetime]")?.getAttribute("datetime") || "";
}

/** Tìm giờ đăng gần tiêu đề bài viết (tránh nhầm với ngày của tin liên quan ở cột bên). */
function dateNearHeading(doc, now) {
  const h1 = doc.querySelector("h1");
  const scopes = [];
  if (h1) {
    let el = h1.parentElement;
    for (let i = 0; el && i < 3; i++, el = el.parentElement) scopes.push(cleanText(el.textContent).slice(0, 1500));
    const body = cleanText(doc.body?.textContent || "");
    const idx = body.indexOf(cleanText(h1.textContent).slice(0, 40));
    if (idx >= 0) scopes.push(body.slice(Math.max(0, idx - 200), idx + 1500));
  }
  for (const text of scopes) {
    const d = parseVietnameseDateTime(text, now);
    if (d) return d;
  }
  return null;
}

/**
 * Phân tích trang bài viết: tiêu đề, mô tả, ảnh, thời gian đăng, nguồn và nội dung chính.
 * Dựa trên các chuẩn chung (Open Graph, JSON-LD, thẻ <time>) và Mozilla Readability
 * nên không phụ thuộc vào class CSS cụ thể của 24HMoney.
 */
export function parseArticle(html, pageUrl, { now = new Date() } = {}) {
  const dom = new JSDOM(html, { url: pageUrl, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const meta = (selector) => doc.querySelector(selector)?.getAttribute("content")?.trim() || "";
  const ld = readJsonLd(doc);

  const title = cleanTitle(
    meta('meta[property="og:title"]') ||
      ld?.headline ||
      meta('meta[name="twitter:title"]') ||
      doc.querySelector("h1")?.textContent ||
      doc.title,
  );
  const description = cleanText(
    meta('meta[property="og:description"]') || meta('meta[name="description"]') || ld?.description || "",
  );
  const image = meta('meta[property="og:image"]') || imageOf(ld?.image) || "";

  let canonical = pageUrl;
  try {
    const href = doc.querySelector('link[rel="canonical"]')?.getAttribute("href");
    if (href) canonical = new URL(href, pageUrl).toString();
  } catch {
    /* giữ URL gốc */
  }

  // Thời gian đăng: ưu tiên dữ liệu có cấu trúc, sau đó mới đến văn bản hiển thị.
  const notFuture = (d) => d && d.getTime() <= now.getTime() + 36e5 ? d : null;
  let publishedAt = null;
  let dateSource = "";
  const structured = [
    meta('meta[property="article:published_time"]'),
    meta('meta[itemprop="datePublished"]'),
    ld?.datePublished,
    meta('meta[name="pubdate"]'),
    meta('meta[name="publishdate"]'),
    meta('meta[property="og:published_time"]'),
    timeNearHeading(doc),
  ];
  for (const value of structured) {
    const d = notFuture(toDate(value));
    if (d) {
      publishedAt = d;
      dateSource = "metadata";
      break;
    }
  }
  if (!publishedAt) {
    const d = notFuture(dateNearHeading(doc, now));
    if (d) {
      publishedAt = d;
      dateSource = "page-text";
    }
  }

  const author = nameOf(ld?.author) || meta('meta[name="author"]') || "";

  // Nội dung chính (Readability chỉnh sửa DOM nên chạy sau cùng).
  let content = "";
  try {
    const parsed = new Readability(doc, { charThreshold: 300 }).parse();
    if (parsed?.content) content = htmlToText(doc, parsed.content);
    if (!publishedAt && parsed?.publishedTime) {
      const d = notFuture(toDate(parsed.publishedTime));
      if (d) {
        publishedAt = d;
        dateSource = "metadata";
      }
    }
  } catch {
    /* fallback bên dưới */
  }
  if (content.length < 200 && typeof ld?.articleBody === "string" && ld.articleBody.length > content.length) {
    content = cleanText(ld.articleBody);
  }
  dom.window.close();

  return {
    id: articleIdFromUrl(pageUrl),
    url: pageUrl,
    canonicalUrl: canonical,
    title,
    description,
    image,
    publishedAt: publishedAt ? publishedAt.toISOString() : null,
    dateSource,
    author,
    sourceName: findSourceName(content) || "",
    content,
  };
}
