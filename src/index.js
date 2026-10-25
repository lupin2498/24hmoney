import { bootstrap } from "./bootstrap.js";
import { createApp } from "./server.js";
import { createLogger } from "./util.js";

const log = createLogger("app");
const { config, store, pipeline } = await bootstrap();
const app = createApp({ config, store, pipeline });

const server = app.listen(config.port, config.host, () => {
  log.info(`Money Insight đang chạy tại http://localhost:${config.port}`);
  if (!config.ai.enabled) log.warn("AI đang tắt (AI_ENABLED=0): chỉ thu thập tin, không tóm tắt/phân tích.");
  else if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    log.warn("Chưa thấy ANTHROPIC_API_KEY – phần tóm tắt/phân tích sẽ không chạy cho tới khi cấu hình.");
  }
  pipeline.start();
});

const shutdown = async (signal) => {
  log.info(`Nhận ${signal}, đang lưu dữ liệu và dừng...`);
  pipeline.stop();
  server.close();
  await store.flush().catch((err) => log.error("Lỗi khi lưu dữ liệu:", err.message));
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
