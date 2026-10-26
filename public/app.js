// Money Insight – giao diện một trang, không phụ thuộc thư viện ngoài.
// Mọi nội dung lấy từ bài báo đều được chèn bằng textContent (không dùng innerHTML) để tránh XSS.

const TZ = "Asia/Ho_Chi_Minh";
const fmtTime = new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const fmtDate = new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const fmtWeekday = new Intl.DateTimeFormat("vi-VN", { timeZone: TZ, weekday: "long" });

const SENTIMENT = {
  tich_cuc: { label: "Tích cực", icon: "▲", cls: "pos" },
  trung_lap: { label: "Trung lập", icon: "●", cls: "neu" },
  tieu_cuc: { label: "Tiêu cực", icon: "▼", cls: "neg" },
  phan_hoa: { label: "Phân hóa", icon: "◆", cls: "mix" },
  chua_ro: { label: "Chưa rõ", icon: "?", cls: "neu" },
};
const IMPACT = { cao: "Tác động cao", trung_binh: "Tác động vừa", thap: "Tác động thấp" };
const HORIZON = { ngan_han: "Ngắn hạn", trung_han: "Trung hạn", dai_han: "Dài hạn" };

const state = {
  status: null,
  dates: [],
  filters: { category: "", sentiment: "", impact: "", q: "" },
  navigated: false,
};

const view = document.getElementById("view");
// Bản ứng dụng điện thoại cung cấp "máy chủ" chạy ngay trên máy (xem mobile/src/main.js).
const local = window.MoneyInsightLocal || null;

// ---------- tiện ích ----------

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "style") Object.assign(el.style, value);
    else if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === "") continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const paragraphs = (text, cls) =>
  String(text || "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => h("p", { class: cls }, p));

const storage = {
  get(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* chế độ riêng tư */
    }
  },
};

function addDays(dateKey, days) {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const atNoon = (dateKey) => new Date(`${dateKey}T12:00:00+07:00`);
const compact = (n) => new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0);
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const time = (iso) => (iso ? fmtTime.format(new Date(iso)) : "--:--");
const dateTime = (iso) => (iso ? `${fmtTime.format(new Date(iso))} ${fmtDate.format(new Date(iso))}` : "");

const SHORT_WEEKDAYS = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

/** Nhãn ngắn cho ô chọn ngày: "Hôm nay", "Hôm qua", "T6 24/10". */
function shortDayLabel(dateKey) {
  const today = state.status?.today;
  if (dateKey === today) return "Hôm nay";
  if (today && dateKey === addDays(today, -1)) return "Hôm qua";
  const [, m, d] = dateKey.split("-");
  return `${SHORT_WEEKDAYS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()]} ${d}/${m}`;
}

function dayLabel(dateKey, { long = false } = {}) {
  const today = state.status?.today;
  const d = atNoon(dateKey);
  const full = `${capitalize(fmtWeekday.format(d))}, ${fmtDate.format(d)}`;
  if (long) return full;
  if (dateKey === today) return `Hôm nay, ${fmtDate.format(d).slice(0, 5)}`;
  if (today && dateKey === addDays(today, -1)) return `Hôm qua, ${fmtDate.format(d).slice(0, 5)}`;
  return full;
}

async function api(path, options = {}) {
  if (local) {
    const { status, body } = await local.request(path, options);
    if (status >= 400) throw new Error(body?.error || `Lỗi (${status})`);
    return body;
  }
  const headers = { Accept: "application/json" };
  if (options.body) headers["Content-Type"] = "application/json";
  const token = storage.get("adminToken");
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401 && !options.retried) {
    const entered = window.prompt("Nhập mã quản trị (ADMIN_TOKEN) để thực hiện thao tác này:");
    if (entered) {
      storage.set("adminToken", entered.trim());
      return api(path, { ...options, retried: true });
    }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Lỗi máy chủ (${res.status})`);
  return data;
}

function sentimentTag(key, { text = true } = {}) {
  const s = SENTIMENT[key];
  if (!s) return null;
  return h("span", { class: `sent sent-${s.cls}` }, h("span", { class: "sent-mark", "aria-hidden": "true" }, s.icon), text ? s.label : null);
}

function actionButton(label, onClick, { kind = "primary", disabled = false } = {}) {
  const btn = h("button", { type: "button", class: `btn btn-${kind}`, disabled }, label);
  btn.addEventListener("click", async () => {
    const original = btn.textContent;
    btn.disabled = true;
    btn.classList.add("busy");
    btn.textContent = "Đang xử lý…";
    try {
      await onClick();
    } catch (err) {
      toast(err.message, true);
      btn.textContent = original;
      btn.disabled = false;
      btn.classList.remove("busy");
    }
  });
  return btn;
}

let toastTimer;
function toast(message, isError = false) {
  let el = document.getElementById("toast");
  if (!el) {
    el = h("div", { id: "toast", class: "toast", role: "alert" });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.toggle("toast-error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 6000);
}

const aiUsable = () => state.status?.ai?.enabled && !state.status?.ai?.blocked;

// ---------- điều hướng ----------

function parseRoute() {
  const [path, query = ""] = location.hash.replace(/^#/, "").split("?");
  const parts = path.split("/").filter(Boolean);
  const params = new URLSearchParams(query);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("d") || "") ? params.get("d") : state.status?.today;
  if (parts[0] === "article" && parts[1]) return { name: "article", id: decodeURIComponent(parts[1]), date };
  if (parts[0] === "news") return { name: "news", date };
  if (parts[0] === "settings" && local) return { name: "settings", date };
  return { name: "digest", date };
}

function href(name, date) {
  const d = date && date !== state.status?.today ? `?d=${date}` : "";
  return name === "news" ? `#/news${d}` : `#/${d}`;
}

function updateChrome(route) {
  for (const a of document.querySelectorAll(".tabs a")) {
    const active = a.dataset.tab === route.name || (route.name === "article" && a.dataset.tab === "news");
    a.classList.toggle("active", active);
    a.setAttribute("aria-current", active ? "page" : "false");
    a.setAttribute("href", href(a.dataset.tab, route.date));
  }
  const select = document.getElementById("date-select");
  const known = new Set(state.dates.map((d) => d.date));
  const options = [...state.dates];
  if (route.date && !known.has(route.date)) options.push({ date: route.date, total: 0 });
  if (state.status?.today && !known.has(state.status.today) && route.date !== state.status.today) {
    options.push({ date: state.status.today, total: 0 });
  }
  options.sort((a, b) => b.date.localeCompare(a.date));
  select.replaceChildren(
    ...options.map((d) =>
      h("option", { value: d.date, selected: d.date === route.date }, `${shortDayLabel(d.date)}${d.total ? ` · ${d.total} tin` : ""}`),
    ),
  );
  const detached = route.name === "article" || route.name === "settings";
  select.disabled = detached;
  document.getElementById("prev-day").disabled = detached;
  document.getElementById("next-day").disabled = detached || route.date >= state.status?.today;
}

function goToDate(date) {
  const route = parseRoute();
  location.hash = href(route.name === "digest" ? "digest" : "news", date).slice(1);
}

document.getElementById("date-select").addEventListener("change", (e) => goToDate(e.target.value));
document.getElementById("prev-day").addEventListener("click", () => goToDate(addDays(parseRoute().date, -1)));
document.getElementById("next-day").addEventListener("click", () => goToDate(addDays(parseRoute().date, 1)));
document.getElementById("refresh-pill").addEventListener("click", () => {
  document.getElementById("refresh-pill").hidden = true;
  render();
});

// ---------- trạng thái & banner ----------

async function loadStatus() {
  const [status, dates] = await Promise.all([api("/api/status"), api("/api/dates")]);
  state.status = status;
  state.dates = dates;
  renderStatus();
}

function renderStatus() {
  const s = state.status;
  const banner = document.getElementById("banner");
  const messages = [];
  if (local?.needsSetup()) {
    messages.push([
      "Nhập API key của Anthropic để bật tóm tắt và phân tích chuyên gia. ",
      h("a", { href: "#/settings" }, "Mở Cài đặt"),
    ]);
  } else if (!s.ai.enabled) {
    messages.push("Tính năng AI đang tắt (AI_ENABLED=0): ứng dụng chỉ thu thập tin, không tóm tắt và phân tích.");
  } else if (s.ai.blocked) {
    const hint =
      s.ai.blocked.code === "auth"
        ? local
          ? " Kiểm tra lại API key trong Cài đặt."
          : " Thêm ANTHROPIC_API_KEY vào file .env rồi khởi động lại ứng dụng."
        : s.ai.blocked.code === "billing"
          ? " Nạp thêm tín dụng tại console.anthropic.com, ứng dụng sẽ tự thử lại sau 30 phút."
          : "";
    messages.push(`Phân tích AI đang tạm dừng: ${s.ai.blocked.message}${hint}`);
  }
  const lc = s.lastCrawl;
  if (lc && lc.discovered === 0 && lc.errors?.length) {
    messages.push(`Lần quét gần nhất không lấy được tin từ 24HMoney: ${lc.errors[0]}`);
  }
  banner.hidden = messages.length === 0;
  banner.replaceChildren(...messages.map((m) => h("p", {}, m)));

  const line = document.getElementById("status-line");
  const parts = [];
  if (s.crawling) parts.push("Đang quét tin mới…");
  else if (lc) parts.push(`Quét lúc ${dateTime(lc.finishedAt)} (+${lc.added} tin)`);
  if (s.nextCrawlAt && !s.crawling) parts.push(`lượt sau ${time(s.nextCrawlAt)}`);
  if (s.ai.enabled) {
    parts.push(`AI: ${s.ai.model}`);
    const u = s.ai.usageToday;
    parts.push(`đã phân tích hôm nay ${u.analyses}/${s.ai.dailyLimit}`);
    if (u.input || u.output) parts.push(`token hôm nay ${compact(u.input)} vào / ${compact(u.output)} ra`);
    if (s.counts.pending) parts.push(`chờ phân tích ${s.counts.pending}`);
  }
  line.replaceChildren(
    parts.join(" · "),
    " ",
    h(
      "button",
      {
        type: "button",
        class: "link-btn",
        disabled: s.crawling,
        onclick: async (e) => {
          e.target.disabled = true;
          e.target.textContent = "Đang quét…";
          try {
            const info = await api("/api/crawl", { method: "POST" });
            toast(`Đã quét xong: thêm ${info.added} tin mới.`);
            await loadStatus();
            render();
          } catch (err) {
            toast(err.message, true);
            e.target.disabled = false;
            e.target.textContent = "Quét ngay";
          }
        },
      },
      "Quét ngay",
    ),
  );
}

async function poll() {
  try {
    const before = state.status;
    await loadStatus();
    const s = state.status;
    const changed =
      before &&
      (before.lastCrawl?.finishedAt !== s.lastCrawl?.finishedAt || before.counts.done !== s.counts.done || before.counts.total !== s.counts.total);
    if (changed && parseRoute().name !== "article") document.getElementById("refresh-pill").hidden = false;
  } catch {
    /* mất kết nối tạm thời */
  }
}

// ---------- các màn hình ----------

async function render() {
  if (!state.status) await loadStatus();
  const route = parseRoute();
  updateChrome(route);
  document.getElementById("refresh-pill").hidden = true;
  try {
    if (route.name === "settings") renderSettings();
    else if (route.name === "article") await renderArticle(route.id);
    else if (route.name === "news") await renderNews(route.date);
    else await renderDigest(route.date);
  } catch (err) {
    view.replaceChildren(h("div", { class: "empty" }, h("p", {}, `Không tải được dữ liệu: ${err.message}`)));
  }
}

function statsCard(items) {
  const economic = items.filter((a) => a.analysis?.is_economic_news !== false);
  const analyzed = economic.filter((a) => a.analysis);
  const counts = { tieu_cuc: 0, trung_lap: 0, tich_cuc: 0 };
  analyzed.forEach((a) => {
    if (a.analysis.sentiment in counts) counts[a.analysis.sentiment]++;
  });
  const high = analyzed.filter((a) => a.analysis.impact_level === "cao").length;
  const total = analyzed.length;

  const tiles = h(
    "div",
    { class: "kpis" },
    h("div", { class: "kpi" }, h("span", { class: "kpi-label" }, "Tin trong ngày"), h("strong", { class: "kpi-value" }, economic.length)),
    h("div", { class: "kpi" }, h("span", { class: "kpi-label" }, "Đã phân tích"), h("strong", { class: "kpi-value" }, total)),
    h("div", { class: "kpi" }, h("span", { class: "kpi-label" }, "Tác động cao"), h("strong", { class: "kpi-value" }, high)),
  );
  if (!total) return h("section", { class: "card stats" }, tiles);

  const order = ["tieu_cuc", "trung_lap", "tich_cuc"];
  const bar = h(
    "div",
    { class: "sent-bar", role: "img", "aria-label": order.map((k) => `${SENTIMENT[k].label}: ${counts[k]} tin`).join(", ") },
    ...order
      .filter((k) => counts[k] > 0)
      .map((k) =>
        h("span", {
          class: `seg seg-${SENTIMENT[k].cls}`,
          style: { flexGrow: String(counts[k]) },
          title: `${SENTIMENT[k].label}: ${counts[k]} tin (${Math.round((counts[k] / total) * 100)}%)`,
        }),
      ),
  );
  const legend = h(
    "ul",
    { class: "legend" },
    ...order.map((k) =>
      h(
        "li",
        {},
        h("span", { class: `swatch seg-${SENTIMENT[k].cls}`, "aria-hidden": "true" }),
        `${SENTIMENT[k].label} `,
        h("strong", {}, counts[k]),
        h("span", { class: "muted" }, ` (${Math.round((counts[k] / total) * 100)}%)`),
      ),
    ),
  );
  return h("section", { class: "card stats" }, tiles, h("h3", { class: "mini-title" }, "Xu hướng tác động của dòng tin"), bar, legend);
}

function articleLink(a) {
  return h(
    "li",
    {},
    h("a", { href: `#/article/${encodeURIComponent(a.id)}` }, a.title),
    h("span", { class: "muted" }, ` · ${time(a.publishedAt || a.discoveredAt)}`),
  );
}

async function renderDigest(date) {
  const [data, list] = await Promise.all([api(`/api/digest?date=${date}`), api(`/api/articles?date=${date}`)]);
  const byId = new Map(list.items.map((a) => [a.id, a]));
  const d = data.digest;
  const nodes = [h("h1", { class: "page-title" }, `Bản tin ${dayLabel(date, { long: true })}`), statsCard(list.items)];

  const regenerate = () =>
    actionButton(
      d ? "Cập nhật bản tin" : "Lập bản tin ngay",
      async () => {
        await api("/api/digest", { method: "POST", body: JSON.stringify({ date }) });
        toast("Đã lập bản tin mới.");
        await loadStatus();
        await render();
      },
      { kind: d ? "secondary" : "primary", disabled: !aiUsable() || data.generating },
    );

  if (!d) {
    const times = state.status.digest.times.join(", ");
    nodes.push(
      h(
        "section",
        { class: "card empty" },
        h("h2", {}, data.generating ? "Đang lập bản tin…" : "Chưa có bản tin chuyên gia cho ngày này"),
        h(
          "p",
          {},
          state.status.ai.enabled
            ? `Bản tin được lập tự động vào ${times} khi có đủ tin đã phân tích. Bạn cũng có thể lập ngay.`
            : local
              ? "Nhập API key của Anthropic trong Cài đặt để lập bản tin."
              : "Cần bật AI (ANTHROPIC_API_KEY) để lập bản tin.",
        ),
        regenerate(),
      ),
    );
  } else {
    const mood = SENTIMENT[d.market_mood];
    nodes.push(
      h(
        "article",
        { class: "card digest" },
        h("p", { class: "eyebrow" }, `Lập lúc ${dateTime(d.createdAt)} · tổng hợp từ ${d.articleCount} tin`),
        h("h2", { class: "digest-headline" }, d.headline),
        h("div", { class: "mood" }, h("span", { class: "mood-label" }, "Tâm lý chung"), sentimentTag(d.market_mood), h("span", { class: "mood-text" }, d.mood_explanation)),
        ...paragraphs(d.overview, "lead"),
      ),
    );

    if (d.themes?.length) {
      nodes.push(
        h(
          "section",
          { class: "section" },
          h("h2", { class: "section-title" }, "Chủ đề nổi bật"),
          ...d.themes.map((t, i) =>
            h(
              "article",
              { class: "card theme" },
              h("h3", {}, h("span", { class: "theme-no" }, i + 1), t.title),
              ...paragraphs(t.analysis),
              t.article_ids?.length
                ? h("ul", { class: "linked" }, ...t.article_ids.map((id) => byId.get(id)).filter(Boolean).map(articleLink))
                : null,
            ),
          ),
        ),
      );
    }
    nodes.push(h("section", { class: "section card" }, h("h2", { class: "section-title" }, "Góc nhìn vĩ mô"), ...paragraphs(d.macro_view)));
    if (d.sectors?.length) {
      nodes.push(
        h(
          "section",
          { class: "section card" },
          h("h2", { class: "section-title" }, "Ngành đáng chú ý"),
          h(
            "ul",
            { class: "sector-list" },
            ...d.sectors.map((s) => h("li", {}, h("div", { class: "sector-head" }, h("strong", {}, s.name), sentimentTag(s.outlook)), h("p", {}, s.reason))),
          ),
        ),
      );
    }
    nodes.push(
      h(
        "section",
        { class: "section two-col" },
        h("div", { class: "card" }, h("h2", { class: "section-title" }, "Cơ hội"), h("ul", { class: "bullets" }, ...d.opportunities.map((x) => h("li", {}, x)))),
        h("div", { class: "card" }, h("h2", { class: "section-title" }, "Rủi ro"), h("ul", { class: "bullets" }, ...d.risks.map((x) => h("li", {}, x)))),
      ),
      h("section", { class: "section card highlight" }, h("h2", { class: "section-title" }, "Chiến lược gợi ý"), ...paragraphs(d.strategy)),
      h("section", { class: "section card" }, h("h2", { class: "section-title" }, "Cần theo dõi"), h("ul", { class: "bullets" }, ...d.watchlist.map((x) => h("li", {}, x)))),
      h("div", { class: "actions" }, regenerate(), h("span", { class: "muted small" }, `Model: ${d.model}`)),
    );
  }

  const highImpact = list.items.filter((a) => a.analysis?.impact_level === "cao").slice(0, 8);
  if (highImpact.length) {
    nodes.push(
      h(
        "section",
        { class: "section card" },
        h("h2", { class: "section-title" }, "Tin tác động cao"),
        h("ul", { class: "linked" }, ...highImpact.map(articleLink)),
        h("a", { class: "more", href: href("news", date) }, "Xem tất cả tin →"),
      ),
    );
  }
  view.replaceChildren(...nodes);
}

function newsCard(a) {
  const an = a.analysis;
  const meta = [h("span", {}, time(a.publishedAt || a.discoveredAt))];
  if (an) {
    meta.push(h("span", {}, an.category), sentimentTag(an.sentiment));
    if (an.impact_level === "cao") meta.push(h("span", { class: "impact-high" }, IMPACT.cao));
  } else {
    meta.push(h("span", { class: "pending" }, a.status === "error" ? "Phân tích lỗi" : "Chờ phân tích"));
  }
  return h(
    "article",
    { class: "card news-item" },
    h(
      "a",
      { href: `#/article/${encodeURIComponent(a.id)}`, class: "news-link" },
      h("div", { class: "meta" }, ...meta),
      h("h3", {}, a.title),
      h("p", { class: "summary" }, an?.summary || a.description || ""),
      an?.tickers?.length ? h("div", { class: "chips" }, ...an.tickers.slice(0, 6).map((t) => h("span", { class: "chip ticker" }, t))) : null,
    ),
  );
}

async function renderNews(date) {
  const list = await api(`/api/articles?date=${date}`);
  const items = list.items;
  const f = state.filters;

  const catCounts = new Map();
  items.forEach((a) => a.analysis && catCounts.set(a.analysis.category, (catCounts.get(a.analysis.category) || 0) + 1));
  const categories = state.status.categories.filter((c) => catCounts.has(c));

  const results = h("div", { class: "news-list" });
  const count = h("p", { class: "muted small result-count" });

  const apply = () => {
    const words = fold(f.q).split(/\s+/).filter(Boolean);
    const shown = items.filter((a) => {
      const an = a.analysis;
      if (f.category && an?.category !== f.category) return false;
      if (f.sentiment && an?.sentiment !== f.sentiment) return false;
      if (f.impact && an?.impact_level !== f.impact) return false;
      if (words.length) {
        const hay = fold([a.title, a.description, an?.summary, an?.tickers?.join(" "), an?.sectors?.join(" ")].join(" "));
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    count.textContent = `${shown.length}/${items.length} tin`;
    results.replaceChildren(
      ...(shown.length
        ? shown.map(newsCard)
        : [h("div", { class: "empty" }, h("p", {}, items.length ? "Không có tin phù hợp bộ lọc." : "Chưa có tin nào cho ngày này. Ứng dụng sẽ tự quét định kỳ."))]),
    );
  };

  const chip = (label, value) => {
    const btn = h("button", { type: "button", class: `filter-chip${f.category === value ? " active" : ""}`, "aria-pressed": String(f.category === value) }, label);
    btn.addEventListener("click", () => {
      f.category = value;
      chipRow.querySelectorAll(".filter-chip").forEach((c) => {
        const on = c === btn;
        c.classList.toggle("active", on);
        c.setAttribute("aria-pressed", String(on));
      });
      apply();
    });
    return btn;
  };
  if (f.category && !categories.includes(f.category)) f.category = "";
  const chipRow = h("div", { class: "chip-row", role: "group", "aria-label": "Lĩnh vực" }, chip("Tất cả", ""), ...categories.map((c) => chip(`${c} (${catCounts.get(c)})`, c)));

  const search = h("input", { type: "search", placeholder: "Tìm tiêu đề, mã cổ phiếu, ngành…", value: f.q, "aria-label": "Tìm kiếm" });
  let timer;
  search.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      f.q = search.value;
      apply();
    }, 200);
  });
  const select = (key, label, options) => {
    const el = h(
      "select",
      { "aria-label": label },
      h("option", { value: "" }, label),
      ...Object.entries(options).map(([v, text]) => h("option", { value: v, selected: f[key] === v }, text)),
    );
    el.addEventListener("change", () => {
      f[key] = el.value;
      apply();
    });
    return el;
  };

  view.replaceChildren(
    h("h1", { class: "page-title" }, `Tin tức ${dayLabel(date, { long: true })}`),
    h(
      "div",
      { class: "toolbar" },
      search,
      h(
        "div",
        { class: "selects" },
        select("sentiment", "Mọi xu hướng", { tich_cuc: "Tích cực", trung_lap: "Trung lập", tieu_cuc: "Tiêu cực" }),
        select("impact", "Mọi tác động", IMPACT),
      ),
    ),
    chipRow,
    count,
    results,
  );
  apply();
}

function fold(text) {
  return String(text || "")
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

async function renderArticle(id) {
  const a = await api(`/api/articles/${encodeURIComponent(id)}`);
  const an = a.analysis;
  const back = h(
    "button",
    {
      type: "button",
      class: "link-btn back",
      onclick: () => (state.navigated ? history.back() : (location.hash = href("news", a.day).slice(1))),
    },
    "‹ Quay lại",
  );

  const origin = [a.sourceName && a.sourceName !== "24HMoney" ? `Nguồn gốc: ${a.sourceName}` : null, `Đăng ${dateTime(a.publishedAt || a.discoveredAt)}`]
    .filter(Boolean)
    .join(" · ");

  const header = h(
    "header",
    { class: "article-head" },
    an
      ? h(
          "div",
          { class: "meta" },
          h("span", { class: "chip" }, an.category),
          sentimentTag(an.sentiment),
          h("span", { class: an.impact_level === "cao" ? "impact-high" : "" }, IMPACT[an.impact_level]),
          h("span", {}, HORIZON[an.time_horizon]),
        )
      : null,
    h("h1", { class: "article-title" }, a.title),
    h("p", { class: "muted small" }, origin),
    /^https?:\/\//.test(a.url || "")
      ? h(
          "a",
          {
            class: "btn btn-secondary source-link",
            href: a.url,
            target: "_blank",
            rel: "noopener noreferrer",
            onclick: local
              ? (e) => {
                  e.preventDefault();
                  local.openExternal(a.url);
                }
              : null,
          },
          "Đọc bài gốc trên 24HMoney ↗",
        )
      : null,
  );

  const analyzeBtn = (label, kind) =>
    actionButton(
      label,
      async () => {
        await api(`/api/articles/${encodeURIComponent(id)}/analyze`, { method: "POST" });
        toast("Đã phân tích xong.");
        await loadStatus();
        await renderArticle(id);
      },
      { kind, disabled: !state.status.ai.enabled },
    );

  const nodes = [back, h("article", { class: "card" }, header)];

  if (!an) {
    nodes.push(
      h(
        "section",
        { class: "card" },
        h("h2", { class: "section-title" }, "Sapo"),
        ...paragraphs(a.description || "Không có sapo."),
        a.status === "error" && a.error ? h("p", { class: "error-text" }, `Lần phân tích trước bị lỗi: ${a.error}`) : null,
        h(
          "p",
          { class: "muted small" },
          a.status === "analyzing" ? "Đang phân tích…" : "Bài này chưa được phân tích (có thể do vượt giới hạn trong ngày hoặc bài đã cũ).",
        ),
        analyzeBtn("Phân tích ngay", "primary"),
      ),
    );
    view.replaceChildren(...nodes);
    window.scrollTo(0, 0);
    return;
  }

  if (!an.is_economic_news) nodes.push(h("p", { class: "note" }, "Bài này được đánh giá không phải tin kinh tế."));

  nodes.push(
    h(
      "section",
      { class: "card" },
      h("h2", { class: "section-title" }, "Tóm tắt"),
      h("p", { class: "lead" }, an.summary),
      an.key_points?.length ? h("ul", { class: "bullets" }, ...an.key_points.map((x) => h("li", {}, x))) : null,
    ),
    h("section", { class: "card" }, h("h2", { class: "section-title" }, "Góc nhìn chuyên gia"), ...paragraphs(an.expert_analysis)),
  );

  if (an.impacts?.length) {
    nodes.push(
      h(
        "section",
        { class: "card" },
        h("h2", { class: "section-title" }, "Tác động"),
        h(
          "ul",
          { class: "impact-list" },
          ...an.impacts.map((it) => h("li", {}, h("div", { class: "impact-head" }, h("strong", {}, it.target), sentimentTag(it.direction)), h("p", {}, it.explanation))),
        ),
      ),
    );
  }

  if (an.tickers?.length || an.sectors?.length) {
    nodes.push(
      h(
        "section",
        { class: "card" },
        an.tickers?.length ? [h("h2", { class: "section-title" }, "Mã cổ phiếu liên quan"), h("div", { class: "chips" }, ...an.tickers.map((t) => h("span", { class: "chip ticker" }, t)))] : null,
        an.sectors?.length ? [h("h2", { class: "section-title" }, "Ngành liên quan"), h("div", { class: "chips" }, ...an.sectors.map((s) => h("span", { class: "chip" }, s)))] : null,
      ),
    );
  }

  if (an.opportunities?.length || an.risks?.length) {
    nodes.push(
      h(
        "section",
        { class: "two-col" },
        h("div", { class: "card" }, h("h2", { class: "section-title" }, "Cơ hội"), an.opportunities.length ? h("ul", { class: "bullets" }, ...an.opportunities.map((x) => h("li", {}, x))) : h("p", { class: "muted" }, "Không nêu.")),
        h("div", { class: "card" }, h("h2", { class: "section-title" }, "Rủi ro"), an.risks.length ? h("ul", { class: "bullets" }, ...an.risks.map((x) => h("li", {}, x))) : h("p", { class: "muted" }, "Không nêu.")),
      ),
    );
  }

  nodes.push(h("section", { class: "card highlight" }, h("h2", { class: "section-title" }, "Hàm ý cho nhà đầu tư"), ...paragraphs(an.investor_takeaway)));
  if (an.watch_next?.length) {
    nodes.push(h("section", { class: "card" }, h("h2", { class: "section-title" }, "Cần theo dõi tiếp"), h("ul", { class: "bullets" }, ...an.watch_next.map((x) => h("li", {}, x)))));
  }
  nodes.push(h("div", { class: "actions" }, analyzeBtn("Phân tích lại", "secondary"), h("span", { class: "muted small" }, `Phân tích lúc ${dateTime(a.analyzedAt)} · ${a.model || ""}`)));

  view.replaceChildren(...nodes);
  window.scrollTo(0, 0);
}

function renderSettings() {
  const s = local.getSettings();
  const field = (label, control, hint) =>
    h("label", { class: "field" }, h("span", { class: "field-label" }, label), control, hint ? h("span", { class: "field-hint" }, hint) : null);

  const apiKey = h("input", { type: "password", value: s.apiKey, autocomplete: "off", spellcheck: "false", placeholder: "sk-ant-..." });
  const model = h("select", {}, ...local.models.map((m) => h("option", { value: m.id, selected: m.id === s.model }, m.label)));
  const dailyLimit = h("input", { type: "number", min: "1", max: "500", inputmode: "numeric", value: String(s.dailyLimit) });
  const crawlInterval = h("input", { type: "number", min: "10", max: "240", inputmode: "numeric", value: String(s.crawlInterval) });

  const save = actionButton("Lưu cài đặt", async () => {
    await local.saveSettings({
      apiKey: apiKey.value,
      model: model.value,
      dailyLimit: dailyLimit.value,
      crawlInterval: crawlInterval.value,
    });
    toast("Đã lưu cài đặt.");
    await loadStatus();
    location.hash = "/";
  });

  view.replaceChildren(
    h("h1", { class: "page-title" }, "Cài đặt"),
    h(
      "section",
      { class: "card form" },
      field(
        "API key của Anthropic",
        apiKey,
        "Tạo tại console.anthropic.com → API Keys. Key chỉ được lưu trên điện thoại này và chỉ dùng để gọi Claude.",
      ),
      field("Model phân tích", model, "Opus cho phân tích sâu nhất; Sonnet/Haiku rẻ hơn."),
      field("Số tin tự động phân tích mỗi ngày", dailyLimit, "Mỗi tin là một lượt gọi API (tính phí vào tài khoản Anthropic của bạn)."),
      field("Chu kỳ cập nhật tin khi mở ứng dụng (phút)", crawlInterval),
      h("div", { class: "actions" }, save),
    ),
  );
}

// ---------- khởi động ----------

window.addEventListener("hashchange", () => {
  state.navigated = true;
  render();
});
render();
setInterval(poll, 60e3);

if (local) document.getElementById("settings-link").hidden = false;
else if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
