// Scenario evals: scripted turns against the agent function, graded by the shared checks in
// supabase/functions/_shared/scenarios.ts (the console's Test step uses the same ones).
// deno run -A evals/run.ts [--repeat 5] [--only id] [--remote] [--keep]
// --keep leaves the chats in the database, so Watchtower has real conversations to show.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { fromFileUrl } from "jsr:@std/path@1/from-file-url";
import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanup, grade, type Run, SCENARIOS, type Scenario } from "../supabase/functions/_shared/scenarios.ts";

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const args = parseArgs(Deno.args, { string: ["only", "repeat"], boolean: ["remote", "keep"] });
const repeat = Number(args.repeat ?? 1);
const env = readEnv(`${ROOT}evals/${args.remote ? ".env.remote" : ".env"}`);
const scenarios = SCENARIOS.filter((s) => !args.only || s.id === args.only);
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

  const run = await grade(db, s, conversationId, replies, failures);
  if (conversationId) await cleanup(db, conversationId, args.keep);
  if (!args.keep) await db.auth.admin.deleteUser(auth.user!.id);
  return run;
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
