import { publicArticle } from "./store.js";
import { CATEGORIES } from "./ai/schemas.js";
import { isDateKey, vnDateKey } from "./util.js";

const reply = (status, body) => ({ status, body });
const BAD_DATE = () => reply(400, { error: "Ngày không hợp lệ (YYYY-MM-DD)." });
const NO_ARTICLE = () => reply(404, { error: "Không tìm thấy bài viết." });

function failure(err, fallbackStatus) {
  const status = err.code === "not_enough" ? 409 : err.code === "config" || err.fatal ? 503 : fallbackStatus;
  return reply(status, { error: err.message, code: err.code });
}

/**
 * Xử lý API dùng chung cho máy chủ Express và ứng dụng điện thoại (gọi trực tiếp, không qua mạng).
 * path không có tiền tố /api, ví dụ "/articles/c1a123/analyze". Mọi request POST là thao tác tốn chi phí.
 */
export async function handleApi({ config, store, pipeline }, { method, path, query = {}, body = {} }) {
  const get = method === "GET";
  const post = method === "POST";
  let m;

  if (get && path === "/status") {
    return reply(200, {
      ...pipeline.status(),
      adminRequired: Boolean(config.adminToken),
      categories: CATEGORIES,
      today: vnDateKey(),
    });
  }

  if (get && path === "/dates") return reply(200, store.dates());

  if (get && path === "/articles") {
    const { date, category, sentiment, impact, q } = query;
    if (date && !isDateKey(date)) return BAD_DATE();
    const items = store.list({ date, category, sentiment, impact, q: q ? String(q).slice(0, 100) : "" });
    const limit = Math.min(Number.parseInt(query.limit, 10) || 300, 1000);
    return reply(200, { total: items.length, items: items.slice(0, limit).map(publicArticle) });
  }

  if (get && (m = path.match(/^\/articles\/([^/]+)$/))) {
    const a = store.get(decodeURIComponent(m[1]));
    return a ? reply(200, publicArticle(a)) : NO_ARTICLE();
  }

  if (post && (m = path.match(/^\/articles\/([^/]+)\/analyze$/))) {
    try {
      const a = await pipeline.analyzeNow(decodeURIComponent(m[1]));
      return a ? reply(200, publicArticle(a)) : NO_ARTICLE();
    } catch (err) {
      return failure(err, 502);
    }
  }

  if (get && path === "/digest") {
    const date = query.date || vnDateKey();
    if (!isDateKey(date)) return BAD_DATE();
    const versions = store.digests.get(date) || [];
    return reply(200, {
      date,
      digest: versions.at(-1) || null,
      versions: versions.length,
      generating: pipeline.digesting.has(date),
    });
  }

  if (post && path === "/digest") {
    const date = body?.date || vnDateKey();
    if (!isDateKey(date)) return BAD_DATE();
    try {
      return reply(200, { date, digest: await pipeline.generateDigest(date, { manual: true }) });
    } catch (err) {
      return failure(err, 502);
    }
  }

  if (post && path === "/crawl") {
    try {
      return reply(200, await pipeline.crawl());
    } catch (err) {
      return failure(err, 500);
    }
  }

  return reply(404, { error: "Không có API này." });
}
