import { loadConfig } from "./config.js";
import { Store } from "./store.js";
import { Crawler } from "./crawler/index.js";
import { Analyst } from "./ai/analyst.js";
import { Pipeline } from "./pipeline.js";

export async function bootstrap(config = loadConfig()) {
  const store = await new Store(config.dataDir, { retentionDays: config.retentionDays }).load();
  const crawler = new Crawler(config.source);
  const analyst = config.ai.enabled ? new Analyst(config.ai) : null;
  const pipeline = new Pipeline({ config, store, crawler, analyst });
  return { config, store, crawler, analyst, pipeline };
}
