import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import { ROOT } from "./config.js";
import { handleApi } from "./api.js";

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

  // Các thao tác tốn chi phí (POST: quét, gọi AI) cần ADMIN_TOKEN nếu đã cấu hình.
  app.use("/api", (req, res, next) => {
    if (req.method !== "POST" || !config.adminToken) return next();
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.get("x-admin-token") || "";
    if (token && safeEqual(token, config.adminToken)) return next();
    res.status(401).json({ error: "Cần mã quản trị (ADMIN_TOKEN) để thực hiện thao tác này." });
  });

  app.use("/api", async (req, res) => {
    const { status, body } = await handleApi(
      { config, store, pipeline },
      { method: req.method, path: req.path, query: req.query, body: req.body },
    );
    res.status(status).json(body);
  });

  app.use(
    express.static(path.join(ROOT, "public"), {
      setHeaders(res, file) {
        if (file.endsWith("sw.js") || file.endsWith(".html")) res.set("Cache-Control", "no-cache");
      },
    }),
  );

  return app;
}
