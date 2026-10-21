// Scenario evals: scripted turns against the agent function, structural assertions on the trace and DB.
// deno run -A evals/run.ts [--repeat 5] [--only id] [--remote]
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { fromFileUrl } from "jsr:@std/path@1/from-file-url";
import { createClient } from "npm:@supabase/supabase-js@2";

type Match = { label: string; outcome?: string; rule_id?: string; detail?: string };
type Assertion =
  | ({ type: "trace_has" | "trace_lacks" } & Match)
  | { type: "call_order"; before: Match; after: Match }
  | { type: "no_tool_before_turn"; label: string; turn: number }
  | { type: "db_row_exists" | "db_row_absent"; table: string; where: Record<string, unknown> }
  | { type: "reply_matches" | "reply_not_matches"; turn?: number | "last"; regex: string }
  | { type: "no_flagged_events" }
  | { type: "escalated"; value: boolean | "any" };

interface Scenario {
  id: string;
  turns: string[];
  assert: Assertion[];
  redteam?: boolean;
  gate?: boolean; // false: reported as a stat, not part of the pass bar
  guard?: string; // guard label whose firing is reported for this scenario
}

interface Event { turn: number; seq: number; kind: string; label: string; detail: string; outcome: string; rule_id: string | null }

interface Run {
  passed: boolean;
  outcome: "resolved" | "escalated" | "failed";
  guards: string[];
  failures: string[];
  replies: string[];
  trace: Event[];
}

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const args = parseArgs(Deno.args, { string: ["only", "repeat"], boolean: ["remote"] });
const repeat = Number(args.repeat ?? 1);
const env = readEnv(`${ROOT}evals/${args.remote ? ".env.remote" : ".env"}`);
const scenarios: Scenario[] = JSON.parse(await Deno.readTextFile(`${ROOT}evals/scenarios.json`))
  .filter((s: Scenario) => !args.only || s.id === args.only);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

if (!scenarios.length) fail(`no scenario named ${args.only}`);

const model = readEnv(`${ROOT}supabase/${args.remote ? ".env.hosted" : ".env"}`, false).ANTHROPIC_MODEL ?? "claude-haiku-5-5";
await runSuite(model);

async function runSuite(model: string) {
  console.log(`\nModel ${model} · ${scenarios.length} scenarios × ${repeat} · ${env.SUPABASE_URL}`);
  const results: Record<string, Run[]> = {};
  for (const s of scenarios) {
    results[s.id] = [];
    for (let i = 0; i < repeat; i++) {
      const run = await runScenario(s);
      results[s.id].push(run);
      console.log(`  ${s.id} #${i + 1}: ${run.passed ? "pass" : "FAIL"} (${run.outcome})${run.failures.map((f) => `\n      - ${f}`).join("")}`);
    }
  }
  printTable(model, results);
  const all = Object.values(results).flat();
  const totals = {
    model,
    total: all.length,
    passed: all.filter((r) => r.passed).length,
    resolved: all.filter((r) => r.outcome === "resolved").length,
    escalated: all.filter((r) => r.outcome === "escalated").length,
    failed: all.filter((r) => r.outcome === "failed").length,
  };
  const { error } = await db.from("eval_runs").insert(totals);
  if (error) console.error(`could not record eval_runs row: ${error.message}`);
  await writeJson("latest.json", { ran_at: new Date().toISOString(), repeat, ...totals, results });
}

async function runScenario(s: Scenario): Promise<Run> {
  const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await anon.auth.signInAnonymously();
  if (authError || !auth.session) fail(`anonymous sign-in failed: ${authError?.message}`);
  const failures: string[] = [];
  const replies: string[] = [];
  let conversationId: string | undefined;

  for (const [i, message] of s.turns.entries()) {
    const res = await fetch(`${env.SUPABASE_URL}/functions/v1/agent`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.session!.access_token}`,
        apikey: env.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversation_id: conversationId, message, redteam: s.redteam ?? false }),
      signal: AbortSignal.timeout(90_000),
    }).catch((e) => fail(`could not reach the function (is \`make serve\` running?): ${e.message}`));
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      failures.push(`turn ${i + 1}: HTTP ${res.status} ${body.error ?? body.msg ?? ""}`);
      break;
    }
    conversationId = body.conversation_id;
    replies.push(body.reply);
  }

  const trace = conversationId ? await rows<Event>("trace_events", conversationId, "turn, seq, kind, label, detail, outcome, rule_id", "seq") : [];
  const escalated = conversationId ? (await rows("escalations", conversationId, "id")).length > 0 : false;
  for (const a of s.assert) {
    const problem = await check(a, { trace, replies, escalated, conversationId });
    if (problem) failures.push(problem);
  }
  if (conversationId) await cleanup(conversationId);
  await db.auth.admin.deleteUser(auth.user!.id);

  const passed = failures.length === 0;
  return {
    passed,
    outcome: passed && !escalated ? "resolved" : escalated ? "escalated" : "failed",
    guards: [...new Set(trace.filter((e) => e.kind === "guard").map((e) => e.label))],
    failures,
    replies,
    trace,
  };
}

async function check(
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
      const early = ctx.trace.find((e) => e.label === a.label && e.turn < a.turn);
      return early ? `${a.label} called in turn ${early.turn}, before turn ${a.turn}` : null;
    }
    case "db_row_exists":
    case "db_row_absent": {
      const count = ctx.conversationId ? await countRows(a.table, a.where, ctx.conversationId) : 0;
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
async function countRows(table: string, where: Record<string, unknown>, conversationId: string): Promise<number> {
  const relations = Object.keys(where).filter((k) => k.includes(".")).map((k) => k.split("."));
  const select = ["id", ...relations.map(([rel, col]) => `${rel}!inner(${col})`)].join(", ");
  let q = db.from(table).select(select).eq("conversation_id", conversationId);
  for (const [k, v] of Object.entries(where)) q = q.eq(k, v as string);
  const { data, error } = await q;
  if (error) throw new Error(`${table} query failed: ${error.message}`);
  return data.length;
}

async function rows<T = unknown>(table: string, conversationId: string, select: string, order?: string): Promise<T[]> {
  let q = db.from(table).select(select).eq("conversation_id", conversationId);
  if (order) q = q.order(order);
  const { data, error } = await q;
  if (error) throw new Error(`${table} query failed: ${error.message}`);
  return data as T[];
}

// Keeps seed data reusable: removes the run's returns and escalations, then the conversation itself.
async function cleanup(conversationId: string) {
  for (const table of ["returns", "escalations", "conversations"]) {
    const { error } = await db.from(table).delete().eq(table === "conversations" ? "id" : "conversation_id", conversationId);
    if (error) console.error(`cleanup ${table} failed: ${error.message}`);
  }
}

function printTable(model: string, results: Record<string, Run[]>) {
  console.log(`\n${model}`);
  console.log(`${"scenario".padEnd(34)}${"pass".padEnd(8)}${"res/esc/fail".padEnd(14)}guard_fired`);
  for (const s of scenarios) {
    const runs = results[s.id];
    const n = (o: Run["outcome"]) => runs.filter((r) => r.outcome === o).length;
    console.log(
      `${(s.id + (s.gate === false ? " (stat)" : "")).padEnd(34)}${`${runs.filter((r) => r.passed).length}/${runs.length}`.padEnd(8)}` +
        `${`${n("resolved")}/${n("escalated")}/${n("failed")}`.padEnd(14)}${guardSummary(s, runs)}`,
    );
  }
  const gated = scenarios.filter((s) => s.gate !== false);
  const gatePass = gated.every((s) => results[s.id].every((r) => r.passed));
  console.log(`\nPass bar (every gated scenario passes every run): ${gatePass ? "PASS" : "FAIL"}`);
}

// "return_blocked 3/5" for a scenario's designated guard, otherwise any guard labels that fired.
function guardSummary(s: Scenario, runs: Run[]): string {
  if (s.guard) return `${s.guard} ${runs.filter((r) => r.guards.includes(s.guard!)).length}/${runs.length}`;
  const labels = [...new Set(runs.flatMap((r) => r.guards))];
  return labels.length ? labels.join(", ") : "-";
}

async function writeJson(name: string, data: unknown) {
  await Deno.writeTextFile(`${ROOT}evals/results/${name}`, JSON.stringify(data, null, 2));
  console.log(`Wrote evals/results/${name}`);
}

function readEnv(path: string, required = true): Record<string, string> {
  let text = "";
  try {
    text = Deno.readTextFileSync(path);
  } catch {
    if (required) fail(`missing ${path}`);
  }
  return Object.fromEntries(
    text.split("\n").map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter((m) => m !== null).map((m) => [m![1], m![2]]),
  );
}

function fail(message: string): never {
  console.error(`eval: ${message}`);
  Deno.exit(1);
}
