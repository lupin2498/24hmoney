import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadConfig } from "../src/config.js";
import { articleIdFromUrl, createUrlTools, extractLinks, parseFeed, parseSitemap } from "../src/crawler/discover.js";
import { parseArticle } from "../src/crawler/article.js";
import { isAllowed, parseRobots } from "../src/crawler/robots.js";
import { Crawler } from "../src/crawler/index.js";
import { HttpError } from "../src/crawler/http.js";

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const source = loadConfig({}).source;
const tools = createUrlTools(source);
const NOW = new Date("2026-10-25T05:00:00Z"); // 12:00 giờ Việt Nam

test("chuẩn hoá URL và nhận diện bài viết", () => {
  assert.equal(
    tools.normalize("https://www.24hmoney.vn/news/a-b-c1a2.html?utm=1#x"),
    "https://24hmoney.vn/news/a-b-c1a2.html",
  );
  assert.equal(tools.normalize("https://cafef.vn/news/a.html"), null);
  assert.equal(tools.normalize("javascript:void(0)"), null);
  assert.ok(tools.isArticle("https://24hmoney.vn/news/vn-index-tang-c1a1500120.html"));
  assert.ok(!tools.isArticle("https://24hmoney.vn/posts/bai-c55a1.html"));
  assert.ok(!tools.isArticle("https://24hmoney.vn/stock/news/abc.html"));
  assert.ok(tools.isListing("https://24hmoney.vn/tin-tuc/vi-mo"));
  assert.equal(articleIdFromUrl("https://24hmoney.vn/news/vn-index-c1a1500120.html"), "c1a1500120");
  assert.match(articleIdFromUrl("https://24hmoney.vn/news/khong-co-ma.html"), /^u[0-9a-z]+$/);
});

test("lấy link bài viết từ trang danh sách, kể cả trong dữ liệu nhúng", () => {
  const { articles, listings, feeds } = extractLinks(fixture("home.html"), "https://24hmoney.vn/", tools);
  const urls = articles.map((a) => a.url).sort();
  assert.deepEqual(urls, [
    "https://24hmoney.vn/news/gia-vang-lap-dinh-moi-c1a1500125.html",
    "https://24hmoney.vn/news/ngan-hang-nha-nuoc-giu-nguyen-lai-suat-dieu-hanh-c1a1500123.html",
    "https://24hmoney.vn/news/vn-index-tang-manh-phien-cuoi-tuan-c1a1500120.html",
    "https://24hmoney.vn/news/xuat-khau-tang-truong-c1a1500118.html",
  ]);
  const vnIndex = articles.find((a) => a.url.includes("vn-index"));
  assert.equal(vnIndex.titleHint, "VN-Index tăng mạnh phiên cuối tuần, khối ngoại mua ròng");
  assert.deepEqual(listings.sort(), ["https://24hmoney.vn/tin-tuc", "https://24hmoney.vn/tin-tuc/vi-mo"]);
  assert.deepEqual(feeds, ["https://24hmoney.vn/rss/tin-moi.rss"]);
});

test("đọc sitemap index, news sitemap và RSS", () => {
  const index = parseSitemap(fixture("sitemap-index.xml"));
  assert.equal(index.isIndex, true);
  assert.equal(index.entries.length, 3);
  const news = parseSitemap(fixture("sitemap-news.xml"));
  assert.equal(news.isIndex, false);
  assert.equal(news.entries[0].title, "Xuất khẩu tăng trưởng & vượt kỳ vọng");
  assert.equal(news.entries[0].publishedAt, "2026-10-25T07:45:00+07:00");
  const items = parseFeed(fixture("feed.rss"));
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Lãi suất huy động giảm nhẹ");
});

test("robots.txt: Disallow/Allow và Sitemap", () => {
  const robots = parseRobots(`User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /api/\nDisallow: /*.json$\nAllow: /api/public\nSitemap: https://24hmoney.vn/sitemap.xml`);
  assert.deepEqual(robots.sitemaps, ["https://24hmoney.vn/sitemap.xml"]);
  assert.equal(isAllowed(robots, "/news/a.html"), true);
  assert.equal(isAllowed(robots, "/api/private"), false);
  assert.equal(isAllowed(robots, "/api/public/x"), true);
  assert.equal(isAllowed(robots, "/data.json"), false);
  assert.equal(isAllowed(parseRobots("User-agent: *\nDisallow:"), "/x"), true);
});

test("phân tích bài có metadata đầy đủ", () => {
  const url = "https://24hmoney.vn/news/ngan-hang-nha-nuoc-giu-nguyen-lai-suat-dieu-hanh-c1a1500123.html";
  const a = parseArticle(fixture("article-meta.html"), url, { now: NOW });
  assert.equal(a.id, "c1a1500123");
  assert.equal(a.title, "Ngân hàng Nhà nước giữ nguyên lãi suất điều hành trong tháng 10");
  assert.match(a.description, /4,5%\/năm/);
  assert.equal(a.publishedAt, "2026-10-25T01:30:00.000Z");
  assert.equal(a.dateSource, "metadata");
  assert.equal(a.image, "https://static.example/nhnn.jpg");
  assert.match(a.content, /Tăng trưởng tín dụng toàn hệ thống/);
  assert.match(a.content, /\n\n/);
  assert.ok(!a.content.includes("Tin liên quan"));
});

test("phân tích bài chỉ có ngày đăng dạng chữ gần tiêu đề", () => {
  const url = "https://24hmoney.vn/news/gia-vang-lap-dinh-moi-c1a1500125.html";
  const a = parseArticle(fixture("article-text-date.html"), url, { now: NOW });
  assert.equal(a.title, "Giá vàng lập đỉnh mới");
  assert.equal(a.publishedAt, "2026-10-25T02:15:00.000Z");
  assert.equal(a.dateSource, "page-text");
  assert.equal(a.sourceName, "Tiền Phong");
  assert.match(a.content, /- Chênh lệch giá trong nước/);
});

class FakeHttp {
  constructor(routes) {
    this.routes = routes;
    this.calls = [];
  }
  async getText(url) {
    this.calls.push(url);
    const body = this.routes[url];
    if (body === undefined) throw new HttpError(404, url);
    return { url, status: 200, contentType: "text/html", text: body };
  }
}

test("Crawler.discover gộp nguồn, lọc tin cũ và sắp bài mới trước", async () => {
  const http = new FakeHttp({
    "https://24hmoney.vn/robots.txt": "User-agent: *\nDisallow: /news/bi-chan\nSitemap: https://24hmoney.vn/sitemap-index.xml",
    "https://24hmoney.vn/": fixture("home.html").replace(
      "</section>",
      '<a href="/news/bi-chan-c1a1500200.html">Bị chặn bởi robots.txt</a></section>',
    ),
    "https://24hmoney.vn/tin-tuc": "<html><body>Không có tin</body></html>",
    "https://24hmoney.vn/tin-tuc/vi-mo": "<html><body></body></html>",
    "https://24hmoney.vn/rss/tin-moi.rss": fixture("feed.rss"),
    "https://24hmoney.vn/sitemap-index.xml": fixture("sitemap-index.xml"),
    "https://24hmoney.vn/sitemaps/news-2026-10.xml": fixture("sitemap-news.xml"),
  });
  const crawler = new Crawler({ ...source, seedPages: ["/"] }, { http, now: () => NOW });
  const { items } = await crawler.discover();
  const ids = items.map((i) => i.id);
  assert.deepEqual(ids, ["c1a1500126", "c1a1500125", "c1a1500123", "c1a1500120", "c1a1500118"]);
  assert.ok(!ids.includes("c1a1500200"), "tôn trọng robots.txt");
  assert.ok(!ids.includes("c1a1000001"), "bỏ tin cũ trong sitemap");
  assert.equal(items.find((i) => i.id === "c1a1500118").titleHint, "Xuất khẩu tăng trưởng & vượt kỳ vọng");
  assert.ok(!http.calls.includes("https://24hmoney.vn/sitemaps/news-2025-01.xml"), "bỏ sitemap cũ");
});
