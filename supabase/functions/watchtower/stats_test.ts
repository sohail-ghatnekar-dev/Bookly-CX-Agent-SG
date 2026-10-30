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
