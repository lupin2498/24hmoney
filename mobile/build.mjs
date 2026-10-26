// Đóng gói giao diện + toàn bộ logic (quét tin, phân tích, bản tin) thành thư mục www/ cho Capacitor.
import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.resolve(here, "..", "public");
const www = path.join(here, "www");

await fs.rm(www, { recursive: true, force: true });
await fs.mkdir(www, { recursive: true });

await build({
  entryPoints: [path.join(here, "src/main.js")],
  outfile: path.join(www, "bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022", "chrome100", "safari15"],
  // Bộ phân tích HTML dùng chung được viết cho jsdom; trên điện thoại thay bằng DOMParser.
  alias: { jsdom: path.join(here, "src/jsdom-shim.js") },
  minify: true,
  legalComments: "eof",
  logLevel: "warning",
});

const html = (await fs.readFile(path.join(pub, "index.html"), "utf8"))
  .replace('src="app.js"', 'src="bundle.js"')
  .replace(/\n\s*<link rel="manifest"[^>]*>/, "");
await fs.writeFile(path.join(www, "index.html"), html);
await fs.copyFile(path.join(pub, "styles.css"), path.join(www, "styles.css"));
await fs.cp(path.join(pub, "icons"), path.join(www, "icons"), { recursive: true });
console.log("Đã đóng gói vào", path.relative(process.cwd(), www) || www);
