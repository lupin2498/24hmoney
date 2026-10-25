/**
 * Bộ phân tích robots.txt tối giản: lấy danh sách Sitemap và luật Allow/Disallow
 * của nhóm "User-agent: *" (luật khớp dài nhất thắng, Allow thắng khi bằng nhau).
 */
export function parseRobots(text) {
  const sitemaps = [];
  const groups = [];
  let current = null;
  let lastWasAgent = false;

  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }
    if (key === "user-agent") {
      if (!lastWasAgent || !current) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // "Disallow:" rỗng nghĩa là cho phép tất cả.
      if (value) current.rules.push({ allow: key === "allow", path: value });
    }
  }

  const star = groups.filter((g) => g.agents.includes("*"));
  const rules = star.flatMap((g) => g.rules).map((r) => ({ ...r, re: patternToRegex(r.path) }));
  return { sitemaps, rules };
}

function patternToRegex(pattern) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

export function isAllowed(robots, pathWithQuery) {
  if (!robots?.rules?.length) return true;
  let best = null;
  for (const rule of robots.rules) {
    if (!rule.re.test(pathWithQuery)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}
