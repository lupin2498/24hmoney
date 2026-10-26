// Lưu dữ liệu trong IndexedDB của ứng dụng (thay cho file JSON trên máy chủ).
const STORE = "kv";

export class IdbBackend {
  constructor(name = "money-insight") {
    this.name = name;
    this.db = null;
  }

  init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => {
        this.db = req.result;
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  }

  #run(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async listDays(kind) {
    const keys = await this.#run("readonly", (s) => s.getAllKeys());
    const prefix = `${kind}/`;
    return keys.filter((k) => typeof k === "string" && k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  }

  read(kind, day) {
    return this.#run("readonly", (s) => s.get(`${kind}/${day}`));
  }

  write(kind, day, json) {
    return this.#run("readwrite", (s) => s.put(json, `${kind}/${day}`));
  }

  remove(kind, day) {
    return this.#run("readwrite", (s) => s.delete(`${kind}/${day}`));
  }

  async readMeta() {
    return (await this.#run("readonly", (s) => s.get("meta"))) ?? null;
  }

  writeMeta(json) {
    return this.#run("readwrite", (s) => s.put(json, "meta"));
  }
}
