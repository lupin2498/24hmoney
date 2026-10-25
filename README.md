# Money Insight – Tin kinh tế 24HMoney · Góc nhìn chuyên gia

Ứng dụng web (cài được lên điện thoại như app) tự động **tổng hợp tin kinh tế từ 24HMoney** (nguồn tin của ứng dụng 24HMoney trên CH Play), sau đó dùng Claude để **tóm tắt và phân tích từng tin dưới góc nhìn chuyên gia kinh tế**, đồng thời lập **bản tin chuyên gia hằng ngày**.

## Tính năng

- **Tự động thu thập tin** từ 24hmoney.vn theo chu kỳ (mặc định 20 phút/lần): trang chủ, trang tin VN-Index, các chuyên mục tin, RSS/sitemap (nếu có). Tôn trọng `robots.txt`, giới hạn tần suất truy cập.
- **Tóm tắt & phân tích từng tin**: tóm tắt 2–3 câu, ý chính, lĩnh vực, xu hướng tác động (tích cực / trung lập / tiêu cực), mức độ tác động, khung thời gian, nhận định chuyên gia (bối cảnh, cơ chế truyền dẫn), tác động tới từng ngành/nhóm tài sản, mã cổ phiếu liên quan, cơ hội, rủi ro, hàm ý cho nhà đầu tư và các chỉ báo cần theo dõi.
- **Bản tin chuyên gia hằng ngày** (tự lập lúc 08:00, 12:00, 16:00, 20:00 hoặc bấm lập ngay): bức tranh tổng thể, tâm lý thị trường, các chủ đề nổi bật (kèm link tới tin liên quan), góc nhìn vĩ mô, ngành đáng chú ý, cơ hội/rủi ro, chiến lược gợi ý, lịch theo dõi.
- **Giao diện tiếng Việt, tối ưu cho điện thoại**: lọc theo lĩnh vực/xu hướng/mức tác động, tìm kiếm không dấu (tiêu đề, mã cổ phiếu, ngành), xem theo ngày, chế độ tối, thêm vào màn hình chính như một app (PWA).

## Cách hoạt động

```
24hmoney.vn ──(quét định kỳ)──► Bộ thu thập ──► Kho dữ liệu (JSON) ──► Claude: tóm tắt + phân tích từng tin
                                                       │                         │
                                                       └──────► Claude: bản tin chuyên gia hằng ngày
                                                                                 │
                                                        Giao diện web / PWA ◄────┘
```

- Bộ thu thập lấy link bài viết dạng `https://24hmoney.vn/news/...-c<số>a<số>.html`, đọc tiêu đề, sapo, giờ đăng (Open Graph, JSON-LD hoặc ngày giờ hiển thị trên trang) và nội dung chính (Mozilla Readability).
- Phân tích dùng Claude API với *structured outputs* (JSON theo schema cố định) nên dữ liệu luôn đúng cấu trúc. Mặc định dùng model `claude-opus-5-5`; khi model chính từ chối vì chính sách an toàn, API tự chuyển sang model dự phòng (`CLAUDE_FALLBACKS=1`).
- Nội dung gốc của bài chỉ được giữ tạm để phân tích, sau đó xoá; ứng dụng hiển thị tóm tắt/phân tích và dẫn link về bài gốc trên 24HMoney.

## Yêu cầu

- Node.js **20.12 trở lên** (khuyên dùng Node 22) – hoặc Docker.
- **API key của Anthropic** để có phần tóm tắt và phân tích: tạo tại <https://console.anthropic.com/settings/keys>. Không có key, ứng dụng vẫn thu thập và hiển thị tin gốc.
- Máy chạy ứng dụng truy cập được `https://24hmoney.vn`.

## Cài đặt và chạy

```bash
npm install
cp .env.example .env      # rồi điền ANTHROPIC_API_KEY vào file .env
npm start
```

Mở <http://localhost:3000>. Ngay khi khởi động, ứng dụng quét tin lần đầu, sau đó tự phân tích các tin mới.

**Dùng trên điện thoại**: máy tính và điện thoại cùng mạng Wi-Fi → mở `http://<địa-chỉ-IP-máy-tính>:3000` trên Chrome → menu ⋮ → *Thêm vào màn hình chính*. Muốn dùng mọi lúc mọi nơi, hãy chạy ứng dụng trên một máy chủ (VPS) bằng Docker, đặt `ADMIN_TOKEN` và gắn tên miền HTTPS – khi đó ứng dụng cài được như app độc lập và đọc được tin đã tải cả khi mất mạng.

### Chạy bằng Docker

```bash
cp .env.example .env      # điền ANTHROPIC_API_KEY, nên đặt ADMIN_TOKEN
docker compose up -d --build
```

### Lệnh chạy một lượt (không cần mở web)

```bash
npm run crawl                 # quét tin + phân tích các tin mới rồi thoát
npm run digest                # lập bản tin chuyên gia cho hôm nay
npm run digest -- 2026-10-24  # lập bản tin cho một ngày cụ thể
```

## Cấu hình chính (file `.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ANTHROPIC_API_KEY` | – | API key Anthropic (bắt buộc để có tóm tắt/phân tích) |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model dùng để phân tích (có thể đổi sang `claude-sonnet-5-5` hoặc `claude-haiku-5-5` để giảm chi phí) |
| `ARTICLE_EFFORT` / `DIGEST_EFFORT` | `medium` / `high` | Mức độ suy luận cho phân tích từng tin / bản tin ngày |
| `AI_DAILY_ARTICLE_LIMIT` | `150` | Số tin tối đa được **tự động** phân tích mỗi ngày (kiểm soát chi phí) |
| `CLAUDE_FALLBACKS` | `1` | Tự chuyển model dự phòng khi model chính từ chối |
| `DIGEST_TIMES` | `08:00,12:00,16:00,20:00` | Các mốc giờ tự lập/cập nhật bản tin (giờ Việt Nam) |
| `CRAWL_INTERVAL_MINUTES` | `20` | Chu kỳ quét tin |
| `SOURCE_PAGES` | `/,/indices/vn-index/tin-tuc` | Các trang danh sách tin của 24HMoney dùng để tìm bài mới |
| `MAX_ARTICLE_AGE_HOURS` | `48` | Bỏ qua bài cũ hơn số giờ này |
| `ADMIN_TOKEN` | – | Nếu đặt, các thao tác tốn chi phí (quét ngay, phân tích, lập bản tin) cần nhập mã này |
| `RETENTION_DAYS` | `30` | Số ngày giữ dữ liệu |

Xem đầy đủ trong [`.env.example`](.env.example).

Chi phí AI phụ thuộc số tin và model: mỗi tin là một lượt gọi API, mỗi bản tin ngày là một lượt gọi. Số tin đã phân tích và số token đã dùng trong ngày hiển thị ở chân trang.

## Xử lý sự cố

- **Không có tin nào**: xem log khi chạy `npm start`. Nếu báo lỗi truy cập, kiểm tra máy có vào được 24hmoney.vn. Nếu trang thay đổi cấu trúc, bổ sung trang danh sách tin vào `SOURCE_PAGES` hoặc chỉnh `ARTICLE_PATH_PATTERN`.
- **"Phân tích AI đang tạm dừng"**: kiểm tra `ANTHROPIC_API_KEY` (sai/thiếu thì sửa `.env` rồi khởi động lại) hoặc tín dụng tài khoản Anthropic (ứng dụng tự thử lại sau 30 phút).
- **Tin "Chờ phân tích"**: đã đạt giới hạn trong ngày hoặc tin đã cũ – mở tin và bấm *Phân tích ngay*.

## Phát triển

```bash
npm test
```

Bộ kiểm thử gồm: bộ thu thập (trích link, sitemap, RSS, robots.txt, phân tích trang bài), module AI (định dạng request, xử lý từ chối/lỗi), điều phối & API, và một kiểm thử đầu-cuối chạy ứng dụng thật với trang tin và API Anthropic giả lập cục bộ.

```
src/
  index.js            khởi động máy chủ web
  cli.js              lệnh chạy một lượt (crawl, digest)
  config.js           đọc cấu hình từ .env
  crawler/            thu thập tin: http, robots.txt, phát hiện link, phân tích trang bài
  ai/                 prompt, schema JSON và lời gọi Claude API
  pipeline.js         lịch quét, hàng đợi phân tích, lập bản tin
  store.js            lưu trữ JSON theo ngày
  server.js           REST API + phục vụ giao diện
public/               giao diện web/PWA (HTML, CSS, JS thuần)
test/                 kiểm thử (node:test)
```

## Lưu ý

- Đây là ứng dụng **không chính thức**, không liên kết với 24HMoney. Ứng dụng chỉ đọc các trang tin công khai với tần suất thấp; hãy tuân thủ điều khoản sử dụng của 24HMoney khi triển khai.
- Nội dung tóm tắt và phân tích do AI tạo ra, **chỉ mang tính tham khảo, không phải khuyến nghị đầu tư**. Luôn đọc bài gốc trước khi ra quyết định.
