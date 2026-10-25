import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, formatVnDateTime, parseVietnameseDateTime, vnClock, vnDateKey } from "../src/util.js";
import { fold } from "../src/store.js";

test("ngày giờ theo múi giờ Việt Nam", () => {
  const d = new Date("2026-10-24T18:30:00Z"); // 01:30 ngày 25/10 giờ VN
  assert.equal(vnDateKey(d), "2026-10-25");
  assert.equal(vnClock(d), "01:30");
  assert.equal(formatVnDateTime(d), "01:30 25/10/2026");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
});

test("đọc ngày giờ tiếng Việt ở nhiều dạng", () => {
  const now = new Date("2026-10-25T05:00:00Z");
  const iso = (s) => parseVietnameseDateTime(s, now)?.toISOString();
  assert.equal(iso("Chủ nhật, 25/10/2026 - 09:15 (GMT+7)"), "2026-10-25T02:15:00.000Z");
  assert.equal(iso("14:35 24/10/2026"), "2026-10-24T07:35:00.000Z");
  assert.equal(iso("Cập nhật 10h20 | 23-10-2026"), "2026-10-23T03:20:00.000Z");
  assert.equal(iso("Ngày 01.09.2026"), "2026-08-31T17:00:00.000Z");
  assert.equal(iso("2 giờ trước"), "2026-10-25T03:00:00.000Z");
  assert.equal(iso("không có ngày"), undefined);
  assert.equal(iso("32/13/2026 10:00"), undefined);
});

test("tìm kiếm không dấu", () => {
  assert.equal(fold("Đồng Việt Nam tăng giá"), "dong viet nam tang gia");
});
