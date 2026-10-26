import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "./config-core.js";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Đọc file .env (nếu có) mà không cần thêm thư viện dotenv.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile) && typeof process.loadEnvFile === "function") {
  process.loadEnvFile(envFile);
}

export function loadConfig(env = process.env) {
  return { ...buildConfig(env), dataDir: path.resolve(ROOT, env.DATA_DIR || "data") };
}
