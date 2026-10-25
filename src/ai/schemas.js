import { z } from "zod";

export const CATEGORIES = [
  "Vĩ mô",
  "Chứng khoán",
  "Ngân hàng - Tài chính",
  "Tiền tệ - Tỷ giá",
  "Bất động sản",
  "Doanh nghiệp",
  "Hàng hóa - Năng lượng",
  "Kinh tế quốc tế",
  "Chính sách - Pháp lý",
  "Công nghệ - Tài sản số",
  "Khác",
];

export const SENTIMENTS = ["tich_cuc", "trung_lap", "tieu_cuc"];
export const IMPACT_LEVELS = ["cao", "trung_binh", "thap"];
export const HORIZONS = ["ngan_han", "trung_han", "dai_han"];
export const DIRECTIONS = ["tich_cuc", "tieu_cuc", "trung_lap", "chua_ro"];

export const ArticleAnalysisSchema = z.object({
  is_economic_news: z
    .boolean()
    .describe("true nếu bài viết là tin kinh tế, tài chính, đầu tư hoặc kinh doanh; false nếu là tin khác (quảng cáo, giải trí, thông báo tính năng ứng dụng...)."),
  category: z.enum(CATEGORIES).describe("Lĩnh vực chính của tin."),
  summary: z.string().describe("Tóm tắt 2-3 câu, nêu rõ sự kiện chính và con số quan trọng nhất."),
  key_points: z.array(z.string()).describe("3-5 ý chính, mỗi ý một câu ngắn, giữ nguyên số liệu trong bài."),
  sentiment: z.enum(SENTIMENTS).describe("Hàm ý chung của tin đối với thị trường và nhà đầu tư."),
  impact_level: z.enum(IMPACT_LEVELS).describe("Mức độ tác động tới nền kinh tế hoặc thị trường."),
  time_horizon: z.enum(HORIZONS).describe("Khung thời gian tác động chủ yếu."),
  expert_analysis: z
    .string()
    .describe("Nhận định chuyên gia 2-4 đoạn văn (ngăn cách bằng dòng trống): bối cảnh, ý nghĩa, cơ chế truyền dẫn, mức độ bất định."),
  impacts: z
    .array(
      z.object({
        target: z.string().describe("Đối tượng chịu tác động: ngành, nhóm tài sản, chỉ số, doanh nghiệp hoặc nhóm người."),
        direction: z.enum(DIRECTIONS),
        explanation: z.string().describe("Giải thích ngắn gọn vì sao."),
      }),
    )
    .describe("2-5 tác động cụ thể."),
  tickers: z.array(z.string()).describe("Mã cổ phiếu niêm yết tại Việt Nam được nhắc tới hoặc chịu ảnh hưởng trực tiếp (VD: VCB, HPG). Để trống nếu không có."),
  sectors: z.array(z.string()).describe("Các ngành liên quan."),
  opportunities: z.array(z.string()).describe("Cơ hội (0-3 ý)."),
  risks: z.array(z.string()).describe("Rủi ro cần lưu ý (0-3 ý)."),
  investor_takeaway: z.string().describe("Một đoạn ngắn: hàm ý hành động cho nhà đầu tư cá nhân, không đưa khuyến nghị mua/bán cụ thể."),
  watch_next: z.array(z.string()).describe("Các chỉ báo, sự kiện hoặc số liệu nên theo dõi tiếp (0-3 ý)."),
});

export const MOODS = ["tich_cuc", "trung_lap", "tieu_cuc", "phan_hoa"];

export const DigestSchema = z.object({
  headline: z.string().describe("Tiêu đề bản tin, tối đa 15 từ, nêu điểm nhấn của ngày."),
  overview: z.string().describe("Bức tranh tổng thể 2-3 đoạn văn (ngăn cách bằng dòng trống)."),
  market_mood: z.enum(MOODS).describe("Tâm lý chung toát ra từ dòng tin trong ngày."),
  mood_explanation: z.string().describe("1-2 câu giải thích nhận định tâm lý."),
  themes: z
    .array(
      z.object({
        title: z.string().describe("Tên chủ đề."),
        analysis: z.string().describe("Phân tích chủ đề: kết nối các tin, ý nghĩa và tác động."),
        article_ids: z.array(z.string()).describe("ID các bài viết thuộc chủ đề (lấy đúng ID trong danh sách)."),
      }),
    )
    .describe("3-6 chủ đề nổi bật nhất, sắp theo mức độ quan trọng."),
  macro_view: z.string().describe("Góc nhìn vĩ mô: tăng trưởng, lạm phát, lãi suất, tỷ giá, dòng vốn, chính sách."),
  sectors: z
    .array(
      z.object({
        name: z.string(),
        outlook: z.enum(SENTIMENTS),
        reason: z.string(),
      }),
    )
    .describe("2-6 ngành đáng chú ý."),
  opportunities: z.array(z.string()).describe("2-4 cơ hội."),
  risks: z.array(z.string()).describe("2-4 rủi ro."),
  strategy: z.string().describe("Gợi ý chiến lược/hành động cho nhà đầu tư cá nhân, có điều kiện và quản trị rủi ro, không khuyến nghị mã cụ thể."),
  watchlist: z.array(z.string()).describe("3-6 sự kiện, số liệu hoặc mốc thời gian cần theo dõi."),
});
