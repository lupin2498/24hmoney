import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import { ROOT } from "./config.js";
import { publicArticle } from "./store.js";
import { CATEGORIES } from "./ai/schemas.js";
import { isDateKey, vnDateKey } from "./util.js";

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export function createApp({ config, store, pipeline }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    next();
  });

  // Các thao tác tốn chi phí (quét, gọi AI) cần ADMIN_TOKEN nếu đã cấu hình.
  const requireAdmin = (req, res, next) => {
    if (!config.adminToken) return next();
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.get("x-admin-token") || "";
    if (token && safeEqual(token, config.adminToken)) return next();
    res.status(401).json({ error: "Cần mã quản trị (ADMIN_TOKEN) để thực hiện thao tác này." });
  };

  const fail = (res, err, fallbackStatus = 500) => {
    const status = err.code === "not_enough" ? 409 : err.code === "config" || err.fatal ? 503 : fallbackStatus;
    res.status(status).json({ error: err.message, code: err.code });
  };

  app.get("/api/status", (req, res) => {
    res.json({
      ...pipeline.status(),
      adminRequired: Boolean(config.adminToken),
      categories: CATEGORIES,
      today: vnDateKey(),
    });
  });

  app.get("/api/dates", (req, res) => res.json(store.dates()));

  app.get("/api/articles", (req, res) => {
    const { date, category, sentiment, impact, q } = req.query;
    if (date && !isDateKey(date)) return res.status(400).json({ error: "Ngày không hợp lệ (YYYY-MM-DD)." });
    const items = store.list({ date, category, sentiment, impact, q: q ? String(q).slice(0, 100) : "" });
    const limit = Math.min(Number.parseInt(req.query.limit, 10) || 300, 1000);
    res.json({ total: items.length, items: items.slice(0, limit).map(publicArticle) });
  });

  app.get("/api/articles/:id", (req, res) => {
    const a = store.get(req.params.id);
    if (!a) return res.status(404).json({ error: "Không tìm thấy bài viết." });
    res.json(publicArticle(a));
  });

  app.post("/api/articles/:id/analyze", requireAdmin, async (req, res) => {
    try {
      const a = await pipeline.analyzeNow(req.params.id);
      if (!a) return res.status(404).json({ error: "Không tìm thấy bài viết." });
      res.json(publicArticle(a));
    } catch (err) {
      fail(res, err, 502);
    }
  });

  app.get("/api/digest", (req, res) => {
    const date = req.query.date || vnDateKey();
    if (!isDateKey(date)) return res.status(400).json({ error: "Ngày không hợp lệ (YYYY-MM-DD)." });
    const versions = store.digests.get(date) || [];
    res.json({
      date,
      digest: versions.at(-1) || null,
      versions: versions.length,
      generating: pipeline.digesting.has(date),
    });
  });

  app.post("/api/digest", requireAdmin, async (req, res) => {
    const date = req.body?.date || vnDateKey();
    if (!isDateKey(date)) return res.status(400).json({ error: "Ngày không hợp lệ (YYYY-MM-DD)." });
    try {
      res.json({ date, digest: await pipeline.generateDigest(date, { manual: true }) });
    } catch (err) {
      fail(res, err, 502);
    }
  });

  app.post("/api/crawl", requireAdmin, async (req, res) => {
    try {
      res.json(await pipeline.crawl());
    } catch (err) {
      fail(res, err);
    }
  });

  app.use("/api", (req, res) => res.status(404).json({ error: "Không có API này." }));

  app.use(
    express.static(path.join(ROOT, "public"), {
      setHeaders(res, file) {
        if (file.endsWith("sw.js") || file.endsWith(".html")) res.set("Cache-Control", "no-cache");
      },
    }),
  );

  return app;
}
