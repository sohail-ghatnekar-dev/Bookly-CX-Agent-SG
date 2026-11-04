// POST /console { action, ... } → the AOP console's backend: build, test, publish, and the logs behind Watchtower.
// Admin only: the caller's session must carry app_metadata.role = "admin". Writes use the service role.
import { createClient, type User } from "npm:@supabase/supabase-js@2";
import { handleMessage } from "../agent/handle.ts";
import { TOOL_DEFS } from "../agent/tools.ts";
import { cleanup, grade, SCENARIOS } from "../_shared/scenarios.ts";

const AOPS = ["order_status", "returns", "policy_qa"];
const MAX_BODY_CHARS = 4000;

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
};

class Refusal extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Input = Record<string, unknown>;
type Action = (user: User, input: Input) => Promise<unknown>;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  if (!auth.user) return json({ error: "Unauthorized" }, 401);
  if (auth.user.app_metadata?.role !== "admin") return json({ error: "This console is for Bookly admins." }, 403);

  const input = (await req.json().catch(() => null)) as Input | null;
  const action = ACTIONS[String(input?.action ?? "")];
  if (!action) return json({ error: "Unknown action" }, 400);

  try {
    return json(await action(auth.user, input!));
  } catch (err) {
    if (err instanceof Refusal) return json({ error: err.message }, err.status);
    console.error("console error:", err instanceof Error ? err.message : err);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});

const ACTIONS: Record<string, Action> = {
  // Everything the Build tab needs: every version of every AOP, its tools, its scenarios and latest test.
  async overview() {
    const { data: versions, error } = await db.from("procedures")
      .select("name, version, body, is_active, published_at, author, note, created_at")
      .eq("is_redteam", false).order("name").order("version", { ascending: false });
    if (error) throw error;
    const { data: runs } = await db.from("simulation_runs").select("id, procedure, version, created_at")
      .order("created_at", { ascending: false }).limit(100);
    const latest = new Map<string, string>();
    for (const r of runs ?? []) latest.has(`${r.procedure}:${r.version}`) || latest.set(`${r.procedure}:${r.version}`, r.id);
    return {
      versions: versions.map((v) => ({ ...v, latest_run: latest.get(`${v.name}:${v.version}`) ?? null })),
      tools: TOOL_DEFS.map((t) => ({ name: t.name, description: t.description })),
      scenarios: SCENARIOS.map(({ id, procedure, turns, gate }) => ({ id, procedure, turns, gate: gate !== false })),
    };
  },

  // One open draft per AOP: saving edits it, or starts one above the highest version.
  async save_draft(user, input) {
    const name = aopName(input.name);
    const body = String(input.body ?? "").trim();
    const note = String(input.note ?? "").trim().slice(0, 200);
    if (!body || body.length > MAX_BODY_CHARS) throw new Refusal(`The AOP must be 1-${MAX_BODY_CHARS} characters.`);
    if (!/^Goal:/i.test(body)) throw new Refusal('Start the AOP with a "Goal:" line.');

    const { data: rows } = await db.from("procedures").select("version, published_at, is_redteam")
      .eq("name", name).order("version", { ascending: false });
    const draft = rows?.find((r) => !r.published_at && !r.is_redteam);
    const fields = { body, note, author: user.email, created_at: new Date().toISOString() };
    let version: number;
    if (draft) {
      version = draft.version;
      const { error } = await db.from("procedures").update(fields).eq("name", name).eq("version", version);
      if (error) throw error;
    } else {
      version = Math.max(0, ...(rows ?? []).filter((r) => !r.is_redteam).map((r) => r.version)) + 1;
      const { error } = await db.from("procedures").insert({ name, version, is_active: false, is_redteam: false, ...fields });
      if (error) throw error;
    }
    await audit(name, version, "draft_saved", user, note);
    return { name, version };
  },

  // Starts a test of one version; the console then runs each scenario with run_scenario.
  async run_start(user, input) {
    const { name, version } = await versionOf(input);
    const scenarios = SCENARIOS.filter((s) => s.procedure === name).map((s) => s.id);
    const { data, error } = await db.from("simulation_runs")
      .insert({ procedure: name, version, scenario_ids: scenarios, started_by: user.email }).select("id").single();
    if (error) throw error;
    await audit(name, version, "simulation_run", user, `${scenarios.length} scenarios`);
    return { run_id: data.id, scenarios };
  },

  // Plays one scripted conversation against the version under test, then grades it like the evals do.
  async run_scenario(user, input) {
    const { data: run } = await db.from("simulation_runs").select("id, procedure, version, scenario_ids")
      .eq("id", String(input.run_id ?? "")).maybeSingle();
    if (!run) throw new Refusal("Unknown run", 404);
    const s = SCENARIOS.find((x) => x.id === input.scenario_id && run.scenario_ids.includes(x.id));
    if (!s) throw new Refusal("Unknown scenario", 404);

    const started = Date.now();
    const replies: string[] = [];
    const failures: string[] = [];
    let conversationId: string | undefined;
    for (const [i, message] of s.turns.entries()) {
      const out = await handleMessage(db, user.id, conversationId, message, {
        versions: { [run.procedure]: run.version },
        source: "simulation",
      });
      if (!out.ok) {
        failures.push(`turn ${i + 1}: ${out.error}`);
        break;
      }
      conversationId = out.body.conversation_id;
      replies.push(out.body.reply);
    }
    const result = await grade(db, s, conversationId, replies, failures);
    if (conversationId) await cleanup(db, conversationId, true);

    const row = {
      run_id: run.id,
      scenario_id: s.id,
      passed: result.passed,
      outcome: result.outcome,
      failures: result.failures,
      replies: result.replies,
      conversation_id: conversationId ?? null,
      ms: Date.now() - started,
    };
    const { error } = await db.from("simulation_results").upsert(row, { onConflict: "run_id,scenario_id" });
    if (error) throw error;
    return { ...row, gate: s.gate !== false, guards: result.guards };
  },

  async run_get(_user, input) {
    const { data: run } = await db.from("simulation_runs").select("*").eq("id", String(input.run_id ?? "")).maybeSingle();
    if (!run) throw new Refusal("Unknown run", 404);
    const { data: results } = await db.from("simulation_results").select("*").eq("run_id", run.id);
    return { run, results: results ?? [] };
  },

  // Publishing needs a passing test of exactly this text: every gated scenario, after the last save.
  async publish(user, input) {
    const { name, version, row } = await versionOf(input);
    if (row.published_at) throw new Refusal(`v${version} is already published. Use rollback to make it active.`);
    const { data: run } = await db.from("simulation_runs").select("id, scenario_ids, created_at")
      .eq("procedure", name).eq("version", version).gt("created_at", row.created_at)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!run) throw new Refusal("Run the simulations on this version first.");
    const { data: results } = await db.from("simulation_results").select("scenario_id, passed").eq("run_id", run.id);
    const gated = SCENARIOS.filter((s) => run.scenario_ids.includes(s.id) && s.gate !== false).map((s) => s.id);
    const missing = gated.filter((id) => !results?.some((r) => r.scenario_id === id && r.passed));
    if (missing.length) throw new Refusal(`Not every simulation passed: ${missing.join(", ")}.`);

    const previous = await activate(name, version, { published_at: new Date().toISOString() });
    await audit(name, version, "published", user, previous ? `replaces v${previous}` : "");
    return { name, version, previous };
  },

  // Makes an earlier published version active again, for when something goes wrong in production.
  async rollback(user, input) {
    const { name, version, row } = await versionOf(input);
    if (!row.published_at) throw new Refusal("Only published versions can be rolled back to.");
    if (row.is_active) throw new Refusal(`v${version} is already active.`);
    const previous = await activate(name, version, {});
    await audit(name, version, "rolled_back", user, previous ? `from v${previous}` : "");
    return { name, version, previous };
  },

  async audit_log() {
    const { data, error } = await db.from("aop_events").select("*").order("created_at", { ascending: false }).limit(40);
    if (error) throw error;
    return { events: data };
  },

  // Watchtower's log view: recent live conversations, newest first, with the guardrails each one hit.
  async conversations() {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db.from("conversations")
      .select("id, created_at, status, current_procedure, current_version, verified_customer_id, messages(turn, role), trace_events(kind, label, outcome)")
      .eq("source", "live").gte("created_at", since).order("created_at", { ascending: false }).limit(60);
    if (error) throw error;
    return {
      conversations: (data as unknown as ConversationRow[])
        .filter((c) => c.messages.some((m) => m.role === "user"))
        .map((c) => ({
          id: c.id,
          created_at: c.created_at,
          status: c.status,
          aop: c.current_procedure ? `${c.current_procedure} v${c.current_version}` : null,
          verified: !!c.verified_customer_id,
          turns: Math.max(...c.messages.filter((m) => m.role === "user").map((m) => m.turn)),
          steps: c.trace_events.length,
          guards: [...new Set(c.trace_events.filter((e) => e.kind === "guard").map((e) => e.label))],
          denials: c.trace_events.filter((e) => e.outcome === "denied" || e.outcome === "blocked").length,
        })),
    };
  },

  // One conversation's full log: what was said, and every step with its input, output and rule.
  async conversation(_user, input) {
    const id = String(input.id ?? "");
    const { data: conv } = await db.from("conversations")
      .select("id, created_at, status, source, current_procedure, current_version, verified_customer_id").eq("id", id).maybeSingle();
    if (!conv) throw new Refusal("Unknown conversation", 404);
    const [{ data: messages }, { data: trace }] = await Promise.all([
      db.from("messages").select("turn, seq, role, content").eq("conversation_id", id).order("seq"),
      db.from("trace_events").select("turn, seq, kind, label, detail, outcome, rule_id, ms, input, output, created_at")
        .eq("conversation_id", id).order("seq"),
    ]);
    const said = (messages ?? []).flatMap((m) => {
      const text = (m.content as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return text ? [{ turn: m.turn, role: m.role, text }] : [];
    });
    return { conversation: { ...conv, verified: !!conv.verified_customer_id }, messages: said, trace: trace ?? [] };
  },
};

interface ConversationRow {
  id: string;
  created_at: string;
  status: string;
  current_procedure: string | null;
  current_version: number | null;
  verified_customer_id: string | null;
  messages: { turn: number; role: string }[];
  trace_events: { kind: string; label: string; outcome: string }[];
}

function aopName(value: unknown): string {
  const name = String(value ?? "");
  if (!AOPS.includes(name)) throw new Refusal("Unknown AOP");
  return name;
}

async function versionOf(input: Input) {
  const name = aopName(input.name);
  const version = Number(input.version);
  const { data: row } = await db.from("procedures").select("version, is_active, published_at, created_at, is_redteam")
    .eq("name", name).eq("version", version).maybeSingle();
  if (!row || row.is_redteam) throw new Refusal("Unknown version", 404);
  return { name, version, row };
}

// At most one active version per AOP (a unique index enforces it), so the old one goes off first.
async function activate(name: string, version: number, extra: Record<string, unknown>): Promise<number | null> {
  const { data: current } = await db.from("procedures").select("version").eq("name", name).eq("is_active", true).maybeSingle();
  if (current) {
    const { error } = await db.from("procedures").update({ is_active: false }).eq("name", name).eq("version", current.version);
    if (error) throw error;
  }
  const { error } = await db.from("procedures").update({ is_active: true, ...extra }).eq("name", name).eq("version", version);
  if (error) throw error;
  return current?.version ?? null;
}

async function audit(procedure: string, version: number | null, action: string, user: User, detail: string) {
  const { error } = await db.from("aop_events").insert({ procedure, version, action, actor: user.email ?? user.id, detail });
  if (error) console.error("audit failed:", error.message);
}

