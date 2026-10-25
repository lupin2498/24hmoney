// Dữ liệu mẫu dùng chung cho các bài kiểm thử.
export const SAMPLE_ANALYSIS = {
  is_economic_news: true,
  category: "Vĩ mô",
  summary: "NHNN giữ nguyên lãi suất điều hành.",
  key_points: ["Lãi suất tái cấp vốn 4,5%", "Lạm phát 9 tháng 3,2%"],
  sentiment: "tich_cuc",
  impact_level: "cao",
  time_horizon: "trung_han",
  expert_analysis: "Đoạn 1.\n\nĐoạn 2.",
  impacts: [{ target: "Ngân hàng", direction: "tich_cuc", explanation: "Chi phí vốn ổn định." }],
  tickers: ["vcb", "VCB", "BID", "VNINDEX"],
  sectors: ["Ngân hàng", "Ngân hàng "],
  opportunities: ["Cổ phiếu ngân hàng"],
  risks: ["Tỷ giá"],
  investor_takeaway: "Theo dõi tỷ giá.",
  watch_next: ["CPI tháng 10"],
};

export function sampleDigest(articleIds = []) {
  return {
    headline: "Lãi suất ổn định, thị trường hưng phấn",
    overview: "Dòng tin trong ngày nghiêng về tích cực.\n\nChính sách tiền tệ tiếp tục hỗ trợ tăng trưởng.",
    market_mood: "tich_cuc",
    mood_explanation: "Đa số tin có hàm ý tích cực với thị trường.",
    themes: [{ title: "Chính sách tiền tệ ổn định", analysis: "Lãi suất điều hành được giữ nguyên.", article_ids: articleIds }],
    macro_view: "Lạm phát trong tầm kiểm soát, tỷ giá là biến số cần theo dõi.",
    sectors: [{ name: "Ngân hàng", outlook: "tich_cuc", reason: "Chi phí vốn ổn định." }],
    opportunities: ["Nhóm cổ phiếu ngân hàng"],
    risks: ["Áp lực tỷ giá"],
    strategy: "Giải ngân từng phần, ưu tiên doanh nghiệp có nền tảng tốt.",
    watchlist: ["CPI tháng 10"],
  };
}
