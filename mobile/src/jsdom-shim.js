// Trên điện thoại không có jsdom: dùng DOMParser sẵn có của WebView với cùng giao diện tối thiểu.
export class VirtualConsole {}

export class JSDOM {
  constructor(html = "", { url } = {}) {
    const document = new DOMParser().parseFromString(String(html), "text/html");
    if (url && document.head) {
      const base = document.createElement("base");
      base.setAttribute("href", url);
      document.head.prepend(base);
    }
    this.window = { document, close() {} };
  }
}
