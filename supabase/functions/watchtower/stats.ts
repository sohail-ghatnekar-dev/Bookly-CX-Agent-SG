// Turns raw conversation rows into the Watchtower summary. Pure: no I/O, so it's unit tested.

export interface ConversationRow {
  id: string;
  status: "active" | "escalated";
  current_procedure: string | null;
  created_at: string;
  messages: { turn: number; role: string }[];
  escalations: { reason: string; rule_ids: string[]; created_at: string }[];
  trace_events: { kind: string; label: string; detail: string; outcome: string; rule_id: string | null; created_at: string }[];
}

export interface Count {
  key: string;
  name: string;
  count: number;
}

export interface Summary {
  days: number;
  conversations: number;
  handled_by_agent: number;
  sent_to_employee: number;
  avg_turns: number;
  returns_created: number;
  flagged_conversations: number;
  topics: Count[];
  handoff_reasons: Count[];
  recent_handoffs: { reason: string; at: string }[];
  controls: (Count & { what: string })[];
  rules_enforced: Count[];
  recent_flags: { name: string; detail: string; at: string }[];
}

const TOPICS: Record<string, string> = {
  order_status: "Order status",
  returns: "Returns",
  policy_qa: "Policy questions",
};

type Event = ConversationRow["trace_events"][number];

// Every control the agent has. Listed even at zero, so the dashboard shows which ones exist; the ones that fired go first.
// Most are guard events with the same label; a failed verification is the verify tool saying no.
const CONTROLS: { key: string; name: string; what: string; match?: (e: Event) => boolean }[] = [
  {
    key: "verify_failed",
    name: "Wrong email or ZIP",
    what: "Identity check said no; nothing shared",
    match: (e) => e.label === "verify_customer" && e.outcome === "denied",
  },
  { key: "return_blocked", name: "Return blocked in code", what: "initiate_return re-checked the rules and refused" },
  { key: "verification_required", name: "Verification required", what: "Order tool called before email + ZIP" },
  { key: "ownership", name: "Someone else's order", what: "Order exists but isn't this customer's" },
  { key: "lockout", name: "Verification lockout", what: "3 wrong email + ZIP attempts" },
  { key: "invalid_citation", name: "Made-up policy cited", what: "Cited an ID not in policy_docs" },
  { key: "unsupported_claim", name: "Return claimed, no RMA", what: "Reply says a return happened; no tool did it" },
  { key: "refusal", name: "Model refused", what: "Claude declined; canned reply sent" },
  { key: "step_limit", name: "Step limit hit", what: "6 model steps without a reply" },
  { key: "unknown_tool", name: "Unknown tool", what: "Claude asked for a tool that doesn't exist" },
];

// Guards that mean "a person should look at this", as opposed to a rule doing its job.
const FLAGGED = new Set(["invalid_citation", "unsupported_claim", "refusal", "step_limit", "unknown_tool"]);

export function summarize(rows: ConversationRow[], days: number): Summary {
  const chats = rows.filter((c) => c.messages.some((m) => m.role === "user"));
  const escalated = chats.filter((c) => c.status === "escalated");
  const events = chats.flatMap((c) => c.trace_events.map((e) => ({ ...e, conversation: c.id })));
  const guards = events.filter((e) => e.kind === "guard");
  const handoffs = escalated.flatMap((c) => c.escalations);

  const turns = chats.map((c) => Math.max(...c.messages.filter((m) => m.role === "user").map((m) => m.turn)));

  return {
    days,
    conversations: chats.length,
    handled_by_agent: chats.length - escalated.length,
    sent_to_employee: escalated.length,
    avg_turns: turns.length ? round(turns.reduce((a, b) => a + b, 0) / turns.length) : 0,
    returns_created: events.filter((e) => e.label === "initiate_return" && e.outcome === "ok").length,
    flagged_conversations: new Set(guards.filter((e) => FLAGGED.has(e.label)).map((e) => e.conversation)).size,
    topics: tally(chats.map((c) => c.current_procedure ?? "other"), (k) => TOPICS[k] ?? "Other"),
    handoff_reasons: tally(handoffs.map((h) => h.rule_ids.at(-1) ?? "none"), (k) => k === "none" ? "No rule involved" : `After a ${k} decision`),
    recent_handoffs: newest(handoffs).slice(0, 3).map((h) => ({ reason: h.reason, at: h.created_at })),
    controls: CONTROLS.map(({ match, ...c }) => ({
      ...c,
      count: (match ? events.filter(match) : guards.filter((e) => e.label === c.key)).length,
    })).sort((a, b) => b.count - a.count),
    rules_enforced: tally(
      events.filter((e) => e.label === "eligibility" && e.outcome === "denied" && e.rule_id).map((e) => e.rule_id!),
      (k) => k,
    ),
    recent_flags: newest(guards.filter((e) => FLAGGED.has(e.label))).slice(0, 5).map((e) => ({
      name: CONTROLS.find((c) => c.key === e.label)?.name ?? e.label,
      detail: e.detail,
      at: e.created_at,
    })),
  };
}

// Counts each key, largest first.
function tally(keys: string[], name: (key: string) => string): Count[] {
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  return [...counts].map(([key, count]) => ({ key, name: name(key), count })).sort((a, b) => b.count - a.count);
}

function newest<T extends { created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
