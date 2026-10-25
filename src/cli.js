// Chạy một lượt không cần mở web: `npm run crawl` hoặc `npm run digest -- 2026-10-25`.
import { bootstrap } from "./bootstrap.js";
import { createLogger, isDateKey, sleep, vnDateKey } from "./util.js";

const log = createLogger("cli");
const [command, arg] = process.argv.slice(2);
const { store, pipeline } = await bootstrap();

try {
  if (command === "crawl") {
    const info = await pipeline.crawl();
    log.info("Kết quả quét:", JSON.stringify(info));
    while (pipeline.ai.running > 0) await sleep(500);
    const s = pipeline.status();
    log.info(`Đã phân tích hôm nay: ${s.ai.usageToday.analyses} bài. Đang chờ: ${s.counts.pending || 0}.`);
    if (s.ai.blocked) log.warn("AI tạm dừng:", s.ai.blocked.message);
  } else if (command === "digest") {
    const day = isDateKey(arg) ? arg : vnDateKey();
    const digest = await pipeline.generateDigest(day, { manual: true });
    log.info(`Bản tin ${day}: ${digest.headline}`);
  } else {
    console.log("Cách dùng: node src/cli.js crawl | node src/cli.js digest [YYYY-MM-DD]");
    process.exitCode = 1;
  }
} catch (err) {
  log.error(err.message);
  process.exitCode = 1;
} finally {
  await store.flush();
}
