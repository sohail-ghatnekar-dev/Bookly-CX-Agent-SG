// Unit tests for the return rules: day 30 vs 31, day 60 vs 61, ebooks, undelivered orders, duplicates.
import { assertEquals } from "jsr:@std/assert@1";
import { evaluateReturn, type ReturnInput } from "./policy.ts";

const NOW = new Date("2026-10-15T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function input(daysAgo: number, overrides: Partial<ReturnInput> = {}): ReturnInput {
  return {
    delivered_at: new Date(NOW.getTime() - daysAgo * DAY_MS),
    format: "hardcover",
    status: "delivered",
    already_returned: false,
    reason: "changed_mind",
    now: NOW,
    ...overrides,
  };
}

Deno.test("changed_mind: day 30 is eligible under RET-30", () => {
  const d = evaluateReturn(input(30));
  assertEquals([d.eligible, d.rule_id, d.days_since_delivery, d.window_days], [true, "RET-30", 30, 30]);
});

Deno.test("changed_mind: day 30 plus 23h still counts as day 30", () => {
  const d = evaluateReturn(input(30 + 23 / 24));
  assertEquals([d.eligible, d.days_since_delivery], [true, 30]);
});

Deno.test("changed_mind: day 31 is denied under RET-30", () => {
  const d = evaluateReturn(input(31));
  assertEquals([d.eligible, d.rule_id, d.days_since_delivery], [false, "RET-30", 31]);
});

Deno.test("damaged_defective: day 60 is eligible under RET-60", () => {
  const d = evaluateReturn(input(60, { reason: "damaged_defective" }));
  assertEquals([d.eligible, d.rule_id, d.window_days], [true, "RET-60", 60]);
});

Deno.test("damaged_defective: day 61 is denied under RET-60", () => {
  const d = evaluateReturn(input(61, { reason: "damaged_defective" }));
  assertEquals([d.eligible, d.rule_id], [false, "RET-60"]);
});

Deno.test("day 41: reason decides the window", () => {
  const changed = evaluateReturn(input(41, { reason: "changed_mind" }));
  const damaged = evaluateReturn(input(41, { reason: "damaged_defective" }));
  assertEquals([changed.eligible, changed.rule_id, changed.days_since_delivery], [false, "RET-30", 41]);
  assertEquals([damaged.eligible, damaged.rule_id], [true, "RET-60"]);
});

Deno.test("ebook is never returnable, even damaged on day 0", () => {
  const d = evaluateReturn(input(0, { format: "ebook", reason: "damaged_defective" }));
  assertEquals([d.eligible, d.rule_id], [false, "RET-DIGITAL"]);
});

Deno.test("undelivered orders are denied, before the ebook check", () => {
  for (const status of ["processing", "shipped", "cancelled"] as const) {
    const d = evaluateReturn(input(0, { status, delivered_at: null, format: "ebook" }));
    assertEquals([d.eligible, d.rule_id], [false, "RET-NOTDELIVERED"]);
  }
});

Deno.test("an item with an existing return is denied, even inside the window", () => {
  const d = evaluateReturn(input(5, { already_returned: true }));
  assertEquals([d.eligible, d.rule_id], [false, "RET-DUPLICATE"]);
});
