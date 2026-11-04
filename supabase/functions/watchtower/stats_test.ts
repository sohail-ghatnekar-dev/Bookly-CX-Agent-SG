// Unit tests for the Watchtower summary: counts, topics, handoffs, and which guards count as flags.
import { assertEquals } from "jsr:@std/assert@1";
import { type ConversationRow, summarize } from "./stats.ts";

function chat(overrides: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: crypto.randomUUID(),
    status: "active",
    current_procedure: "order_status",
    created_at: "2026-10-20T12:00:00Z",
    messages: [{ turn: 1, role: "user" }, { turn: 1, role: "assistant" }, { turn: 2, role: "user" }],
    escalations: [],
    trace_events: [],
    ...overrides,
  };
}

function guard(label: string, created_at = "2026-10-20T12:00:00Z") {
  return { kind: "guard", label, detail: "", outcome: "blocked", rule_id: null, created_at };
}

Deno.test("counts handled vs sent to an employee, and skips empty chats", () => {
  const s = summarize([
    chat(),
    chat({ status: "escalated", escalations: [{ reason: "pushed back", rule_ids: ["RET-30"], created_at: "2026-10-20T12:00:00Z" }] }),
    chat({ messages: [] }),
  ], 30);
  assertEquals([s.conversations, s.handled_by_agent, s.sent_to_employee, s.avg_turns], [2, 1, 1, 2]);
  assertEquals(s.handoff_reasons, [{ key: "RET-30", name: "After a RET-30 decision", count: 1 }]);
});

Deno.test("groups topics by procedure, with no procedure as Other", () => {
  const s = summarize([chat({ current_procedure: "returns" }), chat({ current_procedure: "returns" }), chat({ current_procedure: null })], 30);
  assertEquals(s.topics.map((t) => [t.name, t.count]), [["Returns", 2], ["Other", 1]]);
});

Deno.test("every control is listed; only quality problems count as flags", () => {
  const s = summarize([
    chat({ trace_events: [guard("return_blocked"), { ...guard("verify_customer"), kind: "tool", outcome: "denied" }] }),
    chat({ trace_events: [guard("invalid_citation", "2026-10-21T12:00:00Z")] }),
  ], 30);
  assertEquals(s.controls.find((c) => c.key === "return_blocked")?.count, 1);
  assertEquals(s.controls.find((c) => c.key === "step_limit")?.count, 0);
  assertEquals(s.controls.find((c) => c.key === "verify_failed")?.count, 1);
  assertEquals(s.flagged_conversations, 1);
  assertEquals(s.recent_flags.map((f) => f.name), ["Made-up policy cited"]);
});

Deno.test("rules enforced counts eligibility denials by rule", () => {
  const denied = (rule_id: string) => ({ kind: "tool", label: "eligibility", detail: "", outcome: "denied", rule_id, created_at: "2026-10-20T12:00:00Z" });
  const s = summarize([chat({ trace_events: [denied("RET-30"), denied("RET-DIGITAL")] }), chat({ trace_events: [denied("RET-30")] })], 30);
  assertEquals(s.rules_enforced.map((r) => [r.key, r.count]), [["RET-30", 2], ["RET-DIGITAL", 1]]);
});

function event(label: string, outcome = "ok", extra: Partial<{ detail: string; rule_id: string; kind: string }> = {}) {
  return { kind: "tool", label, detail: "", outcome, rule_id: null, created_at: "2026-10-20T12:00:00Z", ...extra };
}

Deno.test("labels topics from what happened in the chat", () => {
  const s = summarize([
    chat({ current_procedure: "returns", trace_events: [event("eligibility", "denied", { rule_id: "RET-DIGITAL" })] }),
    chat({ current_procedure: "order_status", trace_events: [event("get_order_status", "ok", { detail: "BK-1038 shipped late" })] }),
    chat({ current_procedure: "policy_qa", trace_events: [event("sources", "ok", { detail: "PAY-1" })] }),
    chat({ topic: "Gift cards" }),
  ], 30);
  assertEquals(s.categories.map((c) => c.name).sort(), ["Ebook return", "Gift cards", "Late delivery", "Refunds and payments"]);
});

Deno.test("watchtowers catch an eligible return with no RMA, and a repeat contact within 7 days", () => {
  const customer = crypto.randomUUID();
  const eligibleNoRma = chat({ current_procedure: "returns", trace_events: [event("eligibility", "ok", { rule_id: "RET-30" })] });
  const returned = chat({ current_procedure: "returns", trace_events: [event("eligibility"), event("initiate_return")] });
  const first = chat({ verified_customer_id: customer, created_at: "2026-10-10T12:00:00Z" });
  const again = chat({ verified_customer_id: customer, created_at: "2026-10-14T12:00:00Z" });
  const muchLater = chat({ verified_customer_id: customer, created_at: "2026-10-30T12:00:00Z" });
  const s = summarize([eligibleNoRma, returned, first, again, muchLater], 30);
  const tower = (key: string) => s.watchtowers.find((w) => w.key === key)!;
  assertEquals(tower("return_not_completed").conversations.map((c) => c.id), [eligibleNoRma.id]);
  assertEquals(tower("repeat_contact").conversations.map((c) => c.id), [again.id]);
});

Deno.test("daily rows cover every day, with deflection and average CSAT", () => {
  const now = Date.parse("2026-10-20T18:00:00Z");
  const s = summarize([
    chat({ created_at: "2026-10-20T09:00:00Z", csat: 5 }),
    chat({ created_at: "2026-10-20T10:00:00Z", csat: 2, status: "escalated" }),
  ], 3, now);
  assertEquals(s.daily, [
    { date: "2026-10-18", total: 0, deflected: 0, csat: null },
    { date: "2026-10-19", total: 0, deflected: 0, csat: null },
    { date: "2026-10-20", total: 2, deflected: 1, csat: 3.5 },
  ]);
  assertEquals(s.csat, { rated: 2, average: 3.5, counts: [0, 1, 0, 0, 1] });
});

Deno.test("hourly volume is in Pacific time; messages per chat cap at 10+; cited articles are counted", () => {
  const sources = (detail: string) => ({ kind: "grounding", label: "sources", detail, outcome: "ok", rule_id: null, created_at: "2026-10-20T17:30:00Z" });
  const many = Array.from({ length: 12 }, (_, i) => ({ turn: i + 1, role: "user" }));
  const s = summarize([
    chat({ created_at: "2026-10-20T17:30:00Z", trace_events: [sources("SHIP-2")] }), // 10:30am PDT
    chat({ created_at: "2026-10-20T17:45:00Z", messages: many, trace_events: [sources("SHIP-2, PAY-1")] }),
  ], 30);
  assertEquals(s.hourly[10], 2);
  assertEquals([s.messages_per_chat[1], s.messages_per_chat[9]], [1, 1]);
  assertEquals(s.articles.map((a) => [a.key, a.count]), [["SHIP-2", 2], ["PAY-1", 1]]);
});
