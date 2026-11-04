// Turns raw conversation rows into the Watchtower summary. Pure: no I/O, so it's unit tested.

export interface ConversationRow {
  id: string;
  status: "active" | "escalated";
  current_procedure: string | null;
  current_version?: number | null;
  verified_customer_id?: string | null;
  topic?: string | null; // a category label; worked out from the trace when missing
  csat?: number | null; // 1-5, when the customer rated the chat
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
  categories: (Count & { deflected: number })[];
  daily: { date: string; total: number; deflected: number; csat: number | null }[];
  csat: { rated: number; average: number | null; counts: number[] }; // counts[0] is 1 star … counts[4] is 5
  hourly: number[]; // chats started in each hour of the day, Pacific time
  messages_per_chat: number[]; // chats with 1, 2, … 9, then 10 or more customer messages
  articles: Count[]; // policy documents cited in answers
  watchtowers: {
    key: string;
    name: string;
    category: string;
    rubric: string;
    count: number;
    conversations: Brief[];
  }[];
}

// One conversation, as a watchtower lists it.
export interface Brief {
  id: string;
  created_at: string;
  topic: string;
  aop: string | null;
  status: string;
  verified: boolean;
  csat: number | null;
}

const TOPICS: Record<string, string> = {
  order_status: "Order status",
  returns: "Returns",
  policy_qa: "Policy questions",
};

// A category for "what are customers asking", from the AOP the agent picked and what happened in the chat.
export function topicOf(c: ConversationRow): string {
  if (c.topic) return c.topic;
  const has = (label: string, test: (e: Event) => boolean = () => true) =>
    c.trace_events.some((e) => e.label === label && test(e));
  switch (c.current_procedure) {
    case "returns":
      if (has("eligibility", (e) => e.rule_id === "RET-DIGITAL")) return "Ebook return";
      if (has("eligibility", (e) => e.rule_id === "RET-60")) return "Damaged or defective item";
      return "Change-of-mind return";
    case "order_status":
      return has("get_order_status", (e) => /\blate\b/.test(e.detail)) ? "Late delivery" : "Order tracking";
    case "policy_qa": {
      const cited = c.trace_events.filter((e) => e.label === "sources").map((e) => e.detail).join(" ");
      if (/PAY-/.test(cited)) return "Refunds and payments";
      if (/ACC-/.test(cited)) return "Account and password";
      return "Shipping questions";
    }
    case null:
    case undefined:
      return "Other";
    default:
      return topicName(c.current_procedure);
  }
}

// Watchtowers: each checks every conversation for one thing going wrong, by a plain-English rubric.
const WATCHTOWERS: {
  key: string;
  name: string;
  category: string;
  rubric: string;
  match: (c: ConversationRow, repeat: Set<string>) => boolean;
}[] = [
  {
    key: "return_not_completed",
    name: "Customer didn't get their return",
    category: "Returns",
    rubric: "Eligible for a return, or told one was started, but no RMA was ever issued.",
    match: (c) =>
      c.trace_events.some((e) => (e.label === "eligibility" && e.outcome === "ok") || e.label === "unsupported_claim") &&
      !c.trace_events.some((e) => e.label === "initiate_return" && e.outcome === "ok"),
  },
  {
    key: "late_order",
    name: "Order arriving late",
    category: "Orders",
    rubric: "The customer's order is shipped but past its estimated delivery date.",
    match: (c) => c.trace_events.some((e) => e.label === "get_order_status" && /\blate\b/.test(e.detail)),
  },
  {
    key: "policy_pushback",
    name: "Pushed back on a return decision",
    category: "Returns",
    rubric: "A return was denied by policy and the customer insisted until an employee took over.",
    match: (c) => c.status === "escalated" && c.trace_events.some((e) => e.label === "eligibility" && e.outcome === "denied"),
  },
  {
    key: "repeat_contact",
    name: "Came back within 7 days",
    category: "Experience",
    rubric: "The same verified customer wrote in about the same thing again within a week, so the first chat may not have solved it.",
    match: (c, repeat) => repeat.has(c.id),
  },
  {
    key: "verification_trouble",
    name: "Stuck on verification",
    category: "Experience",
    rubric: "Two or more wrong order number and email attempts, or locked out.",
    match: (c) =>
      c.trace_events.filter((e) => e.label === "verify_customer" && e.outcome === "denied").length >= 2 ||
      c.trace_events.some((e) => e.label === "lockout"),
  },
  {
    key: "unhappy",
    name: "Unhappy customer",
    category: "Experience",
    rubric: "Rated the chat 1 or 2 out of 5.",
    match: (c) => !!c.csat && c.csat <= 2,
  },
  {
    key: "needs_review",
    name: "Needs review",
    category: "Quality",
    rubric: "Made-up policy citations, return claims with no RMA, refusals or step limits.",
    match: (c) => c.trace_events.some((e) => e.kind === "guard" && FLAGGED.has(e.label)),
  },
];

const DAY = 24 * 60 * 60 * 1000;
const PACIFIC_HOUR = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" });
const MAX_LISTED = 40;

// Conversations from a verified customer who already wrote in about the same topic in the week before.
function repeats(chats: ConversationRow[]): Set<string> {
  const last = new Map<string, number>();
  const out = new Set<string>();
  for (const c of [...chats].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (!c.verified_customer_id) continue;
    const key = `${c.verified_customer_id}|${topicOf(c)}`;
    const at = Date.parse(c.created_at);
    if (last.has(key) && at - last.get(key)! < 7 * DAY) out.add(c.id);
    last.set(key, at);
  }
  return out;
}

function brief(c: ConversationRow): Brief {
  return {
    id: c.id,
    created_at: c.created_at,
    topic: topicOf(c),
    aop: c.current_procedure ? `${c.current_procedure}${c.current_version ? ` v${c.current_version}` : ""}` : null,
    status: c.status,
    verified: !!c.verified_customer_id,
    csat: c.csat ?? null,
  };
}

// One row per day, oldest first, ending today.
function byDay(chats: ConversationRow[], days: number, now: number) {
  const out = Array.from({ length: days }, (_, i) => {
    const date = new Date(now - (days - 1 - i) * DAY).toISOString().slice(0, 10);
    return { date, total: 0, deflected: 0, csat: null as number | null, ratings: [] as number[] };
  });
  const index = new Map(out.map((d, i) => [d.date, i]));
  for (const c of chats) {
    const d = out[index.get(c.created_at.slice(0, 10)) ?? -1];
    if (!d) continue;
    d.total++;
    if (c.status !== "escalated") d.deflected++;
    if (c.csat) d.ratings.push(c.csat);
  }
  return out.map(({ ratings, ...d }) => ({ ...d, csat: ratings.length ? round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null }));
}

// AOPs added from the console: "damaged_item" → "Damaged item".
function topicName(key: string): string {
  if (key === "other") return "Other";
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Event = ConversationRow["trace_events"][number];

// Every control the agent has. Listed even at zero, so the dashboard shows which ones exist; the ones that fired go first.
// Most are guard events with the same label; a failed verification is the verify tool saying no.
const CONTROLS: { key: string; name: string; what: string; match?: (e: Event) => boolean }[] = [
  {
    key: "verify_failed",
    name: "Wrong order number or email",
    what: "Identity check said no; nothing shared",
    match: (e) => e.label === "verify_customer" && e.outcome === "denied",
  },
  { key: "return_blocked", name: "Return blocked in code", what: "initiate_return re-checked the rules and refused" },
  { key: "verification_required", name: "Verification required", what: "Order tool called before verification" },
  { key: "ownership", name: "Someone else's order", what: "Order exists but isn't this customer's" },
  { key: "tool_not_allowed", name: "Tool outside the AOP", what: "A tool the active AOP doesn't list; refused" },
  { key: "lockout", name: "Verification lockout", what: "3 wrong order number + email attempts" },
  { key: "invalid_citation", name: "Made-up policy cited", what: "Cited an ID not in policy_docs" },
  { key: "unsupported_claim", name: "Return claimed, no RMA", what: "Reply says a return happened; no tool did it" },
  { key: "refusal", name: "Model refused", what: "Claude declined; canned reply sent" },
  { key: "step_limit", name: "Step limit hit", what: "6 model steps without a reply" },
  { key: "unknown_tool", name: "Unknown tool", what: "Claude asked for a tool that doesn't exist" },
];

// Guards that mean "a person should look at this", as opposed to a rule doing its job.
const FLAGGED = new Set(["invalid_citation", "unsupported_claim", "refusal", "step_limit", "unknown_tool"]);

export function summarize(rows: ConversationRow[], days: number, now = Date.now()): Summary {
  const chats = rows.filter((c) => c.messages.some((m) => m.role === "user"));
  const escalated = chats.filter((c) => c.status === "escalated");
  const events = chats.flatMap((c) => c.trace_events.map((e) => ({ ...e, conversation: c.id })));
  const guards = events.filter((e) => e.kind === "guard");
  const handoffs = escalated.flatMap((c) => c.escalations);

  const turns = chats.map((c) => Math.max(...c.messages.filter((m) => m.role === "user").map((m) => m.turn)));

  const repeat = repeats(chats);
  const ratings = chats.map((c) => c.csat).filter((r): r is number => !!r);
  const byTopic = new Map<string, { count: number; deflected: number }>();
  for (const c of chats) {
    const t = byTopic.get(topicOf(c)) ?? { count: 0, deflected: 0 };
    t.count++;
    if (c.status !== "escalated") t.deflected++;
    byTopic.set(topicOf(c), t);
  }
  const newestFirst = newest(chats);

  return {
    days,
    conversations: chats.length,
    handled_by_agent: chats.length - escalated.length,
    sent_to_employee: escalated.length,
    avg_turns: turns.length ? round(turns.reduce((a, b) => a + b, 0) / turns.length) : 0,
    returns_created: events.filter((e) => e.label === "initiate_return" && e.outcome === "ok").length,
    flagged_conversations: new Set(guards.filter((e) => FLAGGED.has(e.label)).map((e) => e.conversation)).size,
    topics: tally(chats.map((c) => c.current_procedure ?? "other"), (k) => TOPICS[k] ?? topicName(k)),
    handoff_reasons: tally(handoffs.map((h) => h.rule_ids.at(-1) ?? "none"), (k) => k === "none" ? "No rule involved" : `After a ${k} decision`),
    recent_handoffs: newest(handoffs).slice(0, 6).map((h) => ({ reason: h.reason, at: h.created_at })),
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
    categories: [...byTopic].map(([name, t]) => ({ key: name, name, ...t })).sort((a, b) => b.count - a.count),
    daily: byDay(chats, days, now),
    csat: {
      rated: ratings.length,
      average: ratings.length ? round(ratings.reduce((a, b) => a + b, 0) / ratings.length) : null,
      counts: [1, 2, 3, 4, 5].map((n) => ratings.filter((r) => r === n).length),
    },
    hourly: Array.from({ length: 24 }, (_, h) => chats.filter((c) => Number(PACIFIC_HOUR.format(new Date(c.created_at))) === h).length),
    messages_per_chat: Array.from({ length: 10 }, (_, i) => turns.filter((t) => (i === 9 ? t >= 10 : t === i + 1)).length),
    articles: tally(
      events.filter((e) => e.label === "sources" && e.outcome === "ok").flatMap((e) => e.detail.split(/,\s*/)).filter(Boolean),
      (k) => k,
    ),
    watchtowers: WATCHTOWERS.map(({ match, ...w }) => {
      const hits = newestFirst.filter((c) => match(c, repeat));
      return { ...w, count: hits.length, conversations: hits.slice(0, MAX_LISTED).map(brief) };
    }),
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
