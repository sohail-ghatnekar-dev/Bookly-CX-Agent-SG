// Scripted conversations and the yes/no checks that grade them, against the trace and the database.
// Shared by the CLI eval runner (evals/run.ts) and the console's Test step (functions/console).
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import list from "./scenarios.json" with { type: "json" };

type Match = { label: string; outcome?: string; rule_id?: string; detail?: string };
// `say` is how the console words a check when the generated wording would be unreadable (a regex, say).
export type Assertion = { say?: string } & (
  | ({ type: "trace_has" | "trace_lacks" } & Match)
  | { type: "call_order"; before: Match; after: Match }
  | { type: "no_tool_before_turn"; label: string; turn: number; detail?: string }
  | { type: "db_row_exists" | "db_row_absent"; table: string; where: Record<string, unknown> }
  | { type: "reply_matches" | "reply_not_matches"; turn?: number | "last"; regex: string }
  | { type: "no_flagged_events" }
  | { type: "escalated"; value: boolean | "any" }
);

export interface Scenario {
  id: string;
  procedure: string; // the AOP this scenario tests
  expect: string; // what should happen, in plain English
  turns: string[];
  assert: Assertion[];
  redteam?: boolean;
  gate?: boolean; // false: reported as a stat, not part of the pass bar
  guard?: string; // guard label whose firing is reported for this scenario
}

export interface Event { turn: number; seq: number; kind: string; label: string; detail: string; outcome: string; rule_id: string | null }

export interface Check {
  check: string;
  passed: boolean;
  problem?: string;
}

export interface Run {
  passed: boolean;
  checks: Check[];
  outcome: "resolved" | "escalated" | "failed";
  guards: string[];
  failures: string[];
  replies: string[];
  trace: Event[];
}

export const SCENARIOS = list as Scenario[];

// Grades one finished conversation. `failures` carries any problems from sending the turns.
export async function grade(
  db: SupabaseClient,
  s: Scenario,
  conversationId: string | undefined,
  replies: string[],
  failures: string[] = [],
): Promise<Run> {
  const trace = conversationId
    ? await rows<Event>(db, "trace_events", conversationId, "turn, seq, kind, label, detail, outcome, rule_id", "seq")
    : [];
  const escalated = conversationId ? (await rows(db, "escalations", conversationId, "id")).length > 0 : false;
  const checks: Check[] = [];
  for (const a of s.assert) {
    const problem = await check(db, a, { trace, replies, escalated, conversationId });
    if (problem) failures.push(problem);
    checks.push({ check: describe(a), passed: !problem, ...(problem ? { problem } : {}) });
  }
  const passed = failures.length === 0;
  return {
    passed,
    checks,
    outcome: passed && !escalated ? "resolved" : escalated ? "escalated" : "failed",
    guards: [...new Set(trace.filter((e) => e.kind === "guard").map((e) => e.label))],
    failures,
    replies,
    trace,
  };
}

const LABELS: Record<string, string> = {
  verify_customer: "The identity check",
  list_orders: "Listing the customer's orders",
  get_order_status: "Looking up the order",
  eligibility: "The eligibility check",
  initiate_return: "Starting the return",
  get_policy: "Reading the policy documents",
  escalate_to_human: "Handing off to an employee",
  sources: "The policy citation",
  invalid_citation: "A made-up citation",
};
const OUTCOMES: Record<string, string> = { ok: "succeeds", denied: "says no", blocked: "is blocked", flagged: "is flagged" };

// A check in plain English, for the console: "The eligibility check says no under RET-30".
export function describe(a: Assertion): string {
  if (a.say) return a.say;
  const said = (m: Match) =>
    [LABELS[m.label] ?? m.label, m.outcome ? OUTCOMES[m.outcome] ?? m.outcome : "", m.rule_id ? `under ${m.rule_id}` : "",
      m.detail ? `(${m.detail.replace(/\\b/g, "")})` : ""].filter(Boolean).join(" ");
  const line = (where: Record<string, unknown>) => String(Object.values(where)[0]);
  switch (a.type) {
    case "trace_has":
      return said(a);
    case "trace_lacks":
      return `${said(a)}: never happens`;
    case "call_order":
      return `${said(a.after)} only after ${said(a.before).replace(/^The /, "the ")}`;
    case "no_tool_before_turn":
      return `${LABELS[a.label] ?? a.label}${a.detail ? ` for ${a.detail}` : ""} waits for message ${a.turn}`;
    case "db_row_exists":
      return a.table === "returns" ? `A return is recorded for ${line(a.where)}` : "A handoff with a verified customer is recorded";
    case "db_row_absent":
      return a.table === "returns" ? `No return is recorded for ${line(a.where)}` : `No ${a.table} row is recorded`;
    case "reply_matches":
      return `A reply matches /${a.regex}/`;
    case "reply_not_matches":
      return `No reply matches /${a.regex}/`;
    case "no_flagged_events":
      return "Nothing is flagged for review";
    case "escalated":
      return a.value === true ? "The chat is handed to an employee" : a.value === false ? "The agent resolves it without an employee" : "Handoff either way";
  }
}

// Keeps seed data reusable: removes the run's returns and escalations, then the conversation itself.
// With keep, only the returns go, so the next run can return the same book and the chat stays.
export async function cleanup(db: SupabaseClient, conversationId: string, keep = false) {
  for (const table of keep ? ["returns"] : ["returns", "escalations", "conversations"]) {
    const { error } = await db.from(table).delete().eq(table === "conversations" ? "id" : "conversation_id", conversationId);
    if (error) console.error(`cleanup ${table} failed: ${error.message}`);
  }
}

async function check(
  db: SupabaseClient,
  a: Assertion,
  ctx: { trace: Event[]; replies: string[]; escalated: boolean; conversationId?: string },
): Promise<string | null> {
  const matches = (e: Event, m: Match) =>
    e.label === m.label && (!m.outcome || e.outcome === m.outcome) && (!m.rule_id || e.rule_id === m.rule_id) &&
    (!m.detail || new RegExp(m.detail).test(e.detail));
  const show = (m: Match) => [m.label, m.outcome, m.rule_id, m.detail].filter(Boolean).join(" ");
  const repliesFor = (turn?: number | "last") =>
    turn === undefined ? ctx.replies : [turn === "last" ? ctx.replies.at(-1) ?? "" : ctx.replies[turn - 1] ?? ""];

  switch (a.type) {
    case "trace_has":
      return ctx.trace.some((e) => matches(e, a)) ? null : `trace lacks ${show(a)}`;
    case "trace_lacks":
      return ctx.trace.some((e) => matches(e, a)) ? `trace has ${show(a)}` : null;
    case "call_order": {
      // Every `after` event needs an earlier `before` event. Use trace_has to require `after` at all.
      const bad = ctx.trace.find((e) => matches(e, a.after) && !ctx.trace.some((b) => b.seq < e.seq && matches(b, a.before)));
      return bad ? `${show(a.after)} (seq ${bad.seq}) not preceded by ${show(a.before)}` : null;
    }
    case "no_tool_before_turn": {
      const early = ctx.trace.find((e) =>
        e.label === a.label && e.turn < a.turn && (!a.detail || new RegExp(a.detail).test(e.detail))
      );
      return early ? `${show(a)} called in turn ${early.turn}, before turn ${a.turn}` : null;
    }
    case "db_row_exists":
    case "db_row_absent": {
      const count = ctx.conversationId ? await countRows(db, a.table, a.where, ctx.conversationId) : 0;
      const where = JSON.stringify(a.where);
      if (a.type === "db_row_exists") return count > 0 ? null : `no ${a.table} row ${where}`;
      return count === 0 ? null : `${a.table} row exists ${where}`;
    }
    case "reply_matches": {
      const re = new RegExp(a.regex, "i");
      return repliesFor(a.turn).some((r) => re.test(r)) ? null : `no reply (turn ${a.turn ?? "any"}) matches /${a.regex}/`;
    }
    case "reply_not_matches": {
      const re = new RegExp(a.regex, "i");
      const hit = repliesFor(a.turn).find((r) => re.test(r));
      return hit ? `reply matches /${a.regex}/: "${hit.slice(0, 80)}"` : null;
    }
    case "no_flagged_events": {
      const flagged = ctx.trace.filter((e) => e.outcome === "flagged").map((e) => e.label);
      return flagged.length ? `flagged events: ${flagged.join(", ")}` : null;
    }
    case "escalated":
      return a.value === "any" || a.value === ctx.escalated ? null : `escalated is ${ctx.escalated}, expected ${a.value}`;
  }
}

// Rows created by this run's conversation. A dotted key like "order_items.line_code" filters through that relation.
async function countRows(db: SupabaseClient, table: string, where: Record<string, unknown>, conversationId: string) {
  const relations = Object.keys(where).filter((k) => k.includes(".")).map((k) => k.split("."));
  const select = ["id", ...relations.map(([rel, col]) => `${rel}!inner(${col})`)].join(", ");
  let q = db.from(table).select(select).eq("conversation_id", conversationId);
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v as string);
  const { data, error } = await q;
  if (error) throw new Error(`${table} query failed: ${error.message}`);
  return data.length;
}

async function rows<T = unknown>(db: SupabaseClient, table: string, conversationId: string, select: string, order?: string) {
  let q = db.from(table).select(select).eq("conversation_id", conversationId);
  if (order) q = q.order(order);
  const { data, error } = await q;
  if (error) throw new Error(`${table} query failed: ${error.message}`);
  return data as T[];
}
