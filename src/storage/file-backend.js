import fs from "node:fs/promises";
import path from "node:path";

/** Lưu dữ liệu thành file JSON trên đĩa (dùng cho máy chủ Node.js). */
export class FileBackend {
  constructor(dir) {
    this.dir = dir;
  }

  async init() {
    for (const kind of ["articles", "digests"]) await fs.mkdir(path.join(this.dir, kind), { recursive: true });
  }

  #file(kind, day) {
    return path.join(this.dir, kind, `${day}.json`);
  }

  async listDays(kind) {
    const names = await fs.readdir(path.join(this.dir, kind)).catch(() => []);
    return names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
  }

  read(kind, day) {
    return fs.readFile(this.#file(kind, day), "utf8");
  }

  write(kind, day, json) {
    return atomicWrite(this.#file(kind, day), json);
  }

  remove(kind, day) {
    return fs.rm(this.#file(kind, day), { force: true });
  }

  async readMeta() {
    try {
      return await fs.readFile(path.join(this.dir, "meta.json"), "utf8");
    } catch {
      return null;
    }
  }

  writeMeta(json) {
    return atomicWrite(path.join(this.dir, "meta.json"), json);
  }
}

// Ghi ra file tạm rồi đổi tên để không bao giờ để lại file hỏng.
async function atomicWrite(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, file);
}
