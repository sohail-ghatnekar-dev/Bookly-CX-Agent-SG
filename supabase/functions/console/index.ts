// POST /console { action, ... } → the AOP console's backend: build, test, publish, and the logs behind Watchtower.
// Admin only: the caller's session must carry app_metadata.role = "admin". Writes use the service role.
import { createClient, type User } from "npm:@supabase/supabase-js@2";
import { handleMessage } from "../agent/handle.ts";
import { METADATA, METADATA_REF } from "../agent/metadata.ts";
import { ALWAYS_ON, AOP_TOOLS, TOOL_DEFS } from "../agent/tools.ts";
import { cleanup, describe, grade, SCENARIOS } from "../_shared/scenarios.ts";

const MAX_BODY_CHARS = 4000;
const MAX_MESSAGE_CHARS = 1000;
const MAX_AOPS = 12; // every live AOP's Goal line goes into the system prompt
const AOP_NAME = /^[a-z][a-z0-9_]{2,39}$/;
// @tool and #aop references, at the start of a line or after a space or bracket (so emails don't count).
const TOOL_REF = /(?:^|[\s(])@([a-z_]+)/g;
const AOP_REF = /(?:^|[\s(])#([a-z][a-z0-9_]*)/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      .select("name, version, title, body, tools, is_active, published_at, author, note, created_at")
      .eq("is_redteam", false).order("name").order("version", { ascending: false });
    if (error) throw error;
    const { data: runs } = await db.from("simulation_runs").select("id, procedure, version, created_at")
      .order("created_at", { ascending: false }).limit(100);
    const latest = new Map<string, string>();
    for (const r of runs ?? []) latest.has(`${r.procedure}:${r.version}`) || latest.set(`${r.procedure}:${r.version}`, r.id);
    const { data: latestEval } = await db.from("eval_runs").select("model, total, passed, resolved, escalated, ran_at")
      .order("ran_at", { ascending: false }).limit(1).maybeSingle();
    const { data: customTools } = await db.from("custom_tools").select("*").order("created_at", { ascending: false });
    const tried = new Set<string>();
    for (const v of versions.filter((v) => !v.published_at)) {
      if (await triedOnPhone(v.name, v.version, v.created_at)) tried.add(`${v.name}:${v.version}`);
    }
    return {
      versions: versions.map((v) => ({
        ...v,
        latest_run: latest.get(`${v.name}:${v.version}`) ?? null,
        tried_in_preview: tried.has(`${v.name}:${v.version}`),
      })),
      tools: TOOL_DEFS.map((t) => ({
        name: t.name,
        description: t.description,
        always_on: ALWAYS_ON.includes(t.name),
        input_schema: t.input_schema,
      })),
      custom_tools: customTools ?? [],
      latest_eval: latestEval,
      metadata: METADATA,
      scenarios: SCENARIOS.map((s) => ({
        id: s.id,
        procedure: s.procedure,
        expect: s.expect,
        turns: s.turns,
        checks: s.assert.map(describe),
        gate: s.gate !== false,
      })),
    };
  },

  // A new AOP starts as draft v1. Nobody sees it until it passes its tests and is published.
  async create_aop(user, input) {
    const name = String(input.name ?? "");
    if (!AOP_NAME.test(name)) throw new Refusal("Use 3-40 lowercase letters, digits or underscores for the AOP's ID.");
    const { data: existing } = await db.from("procedures").select("name");
    const names = new Set((existing ?? []).map((r) => r.name));
    if (names.has(name)) throw new Refusal(`There's already an AOP called ${name}.`);
    if (names.size >= MAX_AOPS) throw new Refusal(`The console allows up to ${MAX_AOPS} AOPs.`);
    const fields = draftFields(user, input, [...names, name]);
    const { error } = await db.from("procedures").insert({ name, version: 1, is_active: false, is_redteam: false, ...fields });
    if (error) throw error;
    await audit(name, 1, "created", user, fields.note);
    return { name, version: 1 };
  },

  // One open draft per AOP: saving edits it, or starts one above the highest version.
  async save_draft(user, input) {
    const name = await aopName(input.name);
    const fields = draftFields(user, input, await aopNames());

    const { data: rows } = await db.from("procedures").select("version, published_at, is_redteam")
      .eq("name", name).order("version", { ascending: false });
    const draft = rows?.find((r) => !r.published_at && !r.is_redteam);
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
    await audit(name, version, "draft_saved", user, fields.note);
    return { name, version };
  },

  // A new tool, as a request to engineering: what it does, how it's reached, and what it takes. It can't be called,
  // or referenced in an AOP, until it's built and deployed.
  async create_tool(user, input) {
    const name = String(input.name ?? "").trim();
    const description = String(input.description ?? "").trim();
    const type = String(input.type ?? "");
    if (!AOP_NAME.test(name)) throw new Refusal("Use 3-40 lowercase letters, digits or underscores for the tool's name.");
    if (TOOL_DEFS.some((t) => t.name === name)) throw new Refusal(`There's already a tool called ${name}.`);
    if (!description || description.length > 500) throw new Refusal("Describe what the tool does, in up to 500 characters.");
    if (!["coded", "api", "integration"].includes(type)) throw new Refusal("Pick a tool type.");
    const method = type === "api" ? String(input.method ?? "GET") : null;
    const url = type === "api" ? String(input.url ?? "").trim() : null;
    if (type === "api" && (!/^https:\/\/\S+$/.test(url ?? "") || !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method!))) {
      throw new Refusal("An API tool needs a method and an https:// endpoint.");
    }
    const raw = Array.isArray(input.inputs) ? input.inputs.slice(0, 10) : [];
    const inputs = raw.map((i: Record<string, unknown>) => ({
      name: String(i.name ?? "").trim(),
      type: ["string", "number", "boolean"].includes(String(i.type)) ? String(i.type) : "string",
      required: i.required === true,
      description: String(i.description ?? "").trim().slice(0, 200),
    })).filter((i) => /^[a-z][a-z0-9_]{0,39}$/.test(i.name));
    const guardrails = String(input.guardrails ?? "").trim().slice(0, 500);
    const { data, error } = await db.from("custom_tools")
      .insert({ name, description, type, method, url, inputs, guardrails, created_by: user.email ?? user.id }).select("*").single();
    if (error?.code === "23505") throw new Refusal(`There's already a tool called ${name}.`);
    if (error) throw error;
    return { tool: data };
  },

  // Throws away the open draft. Published versions are never deleted.
  async discard_draft(user, input) {
    const { name, version, row } = await versionOf(input);
    if (row.published_at) throw new Refusal("Only drafts can be discarded.");
    const { error } = await db.from("procedures").delete().eq("name", name).eq("version", version);
    if (error) throw error;
    await audit(name, version, "draft_discarded", user, "");
    return { name, version };
  },

  // Takes an AOP out of the agent: no version is active, so the concierge can't pick it. Publish or roll back to return.
  async retire(user, input) {
    const name = await aopName(input.name);
    const { data: current } = await db.from("procedures").select("version").eq("name", name).eq("is_active", true).maybeSingle();
    if (!current) throw new Refusal("This AOP isn't live.");
    const { error } = await db.from("procedures").update({ is_active: false }).eq("name", name).eq("version", current.version);
    if (error) throw error;
    await audit(name, current.version, "retired", user, "");
    return { name, version: current.version };
  },

  // One message from the console's test phone, against live AOPs plus the version under test, if any.
  // Test chats are kept for their logs but stay out of Watchtower.
  async chat(user, input) {
    const message = typeof input.message === "string" ? input.message.trim() : "";
    if (!message || message.length > MAX_MESSAGE_CHARS) throw new Refusal(`Messages must be 1-${MAX_MESSAGE_CHARS} characters.`);
    const conversationId = input.conversation_id ?? null;
    if (conversationId !== null && !UUID.test(String(conversationId))) throw new Refusal("Unknown conversation", 404);
    const versions = input.testing ? await versionOf(input.testing as Input).then(({ name, version }) => ({ [name]: version })) : undefined;
    const out = await handleMessage(db, user.id, conversationId as string | null, message, { versions, source: "test" });
    if (!out.ok) throw new Refusal(out.error, out.status);
    return out.body;
  },

  // The test phone's "How helpful was this?" stars. Only test chats can be rated here, so live CSAT stays the customers'.
  async rate(_user, input) {
    const id = String(input.conversation_id ?? "");
    const rating = Number(input.rating);
    if (!UUID.test(id)) throw new Refusal("Unknown conversation", 404);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Refusal("Ratings are 1 to 5 stars.");
    const { data, error } = await db.from("conversations").update({ csat: rating }).eq("id", id).eq("source", "test").select("id");
    if (error) throw error;
    if (!data?.length) throw new Refusal("Unknown conversation", 404);
    return { conversation_id: id, rating };
  },

  // Starts a test of one version; the console then runs each scenario with run_scenario.
  async run_start(user, input) {
    const { name, version } = await versionOf(input);
    // A new AOP has no scripted scenarios yet. Adding it changes what the concierge can pick,
    // so its test is every existing scenario, to show the other AOPs still behave.
    const own = SCENARIOS.filter((s) => s.procedure === name).map((s) => s.id);
    const scenarios = own.length ? own : SCENARIOS.map((s) => s.id);
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
      checks: result.checks,
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
    if (!SCENARIOS.some((s) => s.procedure === name) && !(await triedOnPhone(name, version, row.created_at))) {
      throw new Refusal(`Try v${version} in the test phone first: no scripted scenario covers a new AOP yet.`);
    }

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

  // The seeded customers and their orders, for the test phone's cheat sheet. Days are counted from today.
  async test_customers() {
    const { data, error } = await db.from("orders")
      .select("order_number, status, delivered_at, placed_at, customers!inner(email), order_items(title, format)")
      .order("placed_at", { ascending: false });
    if (error) throw error;
    const day = 24 * 60 * 60 * 1000;
    return {
      orders: data.map((o) => ({
        order_number: o.order_number,
        email: (o.customers as unknown as { email: string }).email,
        status: o.status,
        delivered_days_ago: o.delivered_at ? Math.floor((Date.now() - Date.parse(o.delivered_at)) / day) : null,
        items: o.order_items.map((i: { title: string; format: string }) => i.format === "ebook" ? `${i.title} (ebook)` : i.title),
      })),
    };
  },

  async audit_log() {
    const { data, error } = await db.from("aop_events").select("*").order("created_at", { ascending: false }).limit(40);
    if (error) throw error;
    const { data: names } = await db.from("procedures").select("name, title").order("version", { ascending: false });
    const titles = new Map<string, string>();
    for (const p of names ?? []) if (p.title && !titles.has(p.name)) titles.set(p.name, p.title);
    return { events: data.map((e) => ({ ...e, title: titles.get(e.procedure) ?? null })) };
  },

  // Watchtower's log view: recent live conversations (or test-phone chats), newest first, with the guardrails each hit.
  async conversations(_user, input) {
    const source = input.source === "test" ? "test" : "live";
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db.from("conversations")
      .select("id, created_at, status, current_procedure, current_version, verified_customer_id, messages(turn, role), trace_events(kind, label, outcome), escalations(reason)")
      .eq("source", source).gte("created_at", since).order("created_at", { ascending: false }).limit(60);
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
          // Watchtower keys this conversation matches: its guardrails, plus a failed identity check.
          flags: [...new Set([
            ...c.trace_events.filter((e) => e.kind === "guard").map((e) => e.label),
            ...c.trace_events.some((e) => e.label === "verify_customer" && e.outcome === "denied") ? ["verify_failed"] : [],
          ])],
          handoff: c.escalations[0]?.reason ?? null,
          denials: c.trace_events.filter((e) => e.outcome === "denied" || e.outcome === "blocked").length,
        })),
    };
  },

  // One conversation's full log: what was said, and every step with its input, output and rule.
  async conversation(_user, input) {
    const id = String(input.id ?? "");
    const { data: conv } = await db.from("conversations")
      .select("id, created_at, status, source, current_procedure, current_version, verified_customer_id, csat").eq("id", id).maybeSingle();
    if (!conv) throw new Refusal("Unknown conversation", 404);
    const [{ data: messages }, { data: trace }] = await Promise.all([
      db.from("messages").select("turn, seq, role, content").eq("conversation_id", id).order("seq"),
      db.from("trace_events").select("turn, seq, kind, label, detail, outcome, rule_id, ms, input, output, created_at")
        .eq("conversation_id", id).order("seq"),
    ]);
    // Text next to a tool call is the agent narrating its next step; the customer only gets the final reply.
    const said = (messages ?? []).flatMap((m) => {
      const blocks = m.content as { type: string; text?: string }[];
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      return text ? [{ turn: m.turn, role: m.role, text, sent: !blocks.some((b) => b.type === "tool_use") }] : [];
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
  escalations: { reason: string }[];
}

async function aopName(value: unknown): Promise<string> {
  const name = String(value ?? "");
  if (!AOP_NAME.test(name)) throw new Refusal("Unknown AOP", 404);
  const { count } = await db.from("procedures").select("id", { count: "exact", head: true }).eq("name", name);
  if (!count) throw new Refusal("Unknown AOP", 404);
  return name;
}

// What a saved version holds: its text, its title, and the tools it may call: the ones its text references with @.
function draftFields(user: User, input: Input, aops: string[]) {
  const body = String(input.body ?? "").trim();
  const title = String(input.title ?? "").trim().slice(0, 60);
  const note = String(input.note ?? "").trim().slice(0, 200);
  if (!title) throw new Refusal("Give the AOP a name.");
  if (!body || body.length > MAX_BODY_CHARS) throw new Refusal(`The AOP must be 1-${MAX_BODY_CHARS} characters.`);
  if (!/^Goal:/i.test(body)) throw new Refusal("Say what the AOP is used for.");
  const refs = [...new Set([...body.matchAll(TOOL_REF)].map((m) => m[1]))];
  const unknownTools = refs.filter((t) => !TOOL_DEFS.some((d) => d.name === t));
  if (unknownTools.length) throw new Refusal(`There's no tool called ${unknownTools.map((t) => `@${t}`).join(", ")}.`);
  const unknownAops = [...new Set([...body.matchAll(AOP_REF)].map((m) => m[1]))].filter((a) => !aops.includes(a));
  if (unknownAops.length) throw new Refusal(`There's no AOP called ${unknownAops.map((a) => `#${a}`).join(", ")}.`);
  const unknownKeys = [...new Set([...body.matchAll(METADATA_REF)].map((m) => m[1]))].filter((k) => !METADATA.some((d) => d.key === k));
  if (unknownKeys.length) throw new Refusal(`There's no metadata called ${unknownKeys.map((k) => `{{ ${k} }}`).join(", ")}.`);
  const tools = refs.filter((t) => AOP_TOOLS.includes(t));
  return { body, title, tools, note, author: user.email, created_at: new Date().toISOString() };
}

async function aopNames(): Promise<string[]> {
  const { data } = await db.from("procedures").select("name");
  return [...new Set((data ?? []).map((r) => r.name))];
}

// A new AOP's publish needs someone to have chatted with exactly this text in the test phone.
async function triedOnPhone(name: string, version: number, since: string): Promise<boolean> {
  const { count } = await db.from("conversations").select("id", { count: "exact", head: true })
    .eq("source", "test").eq("current_procedure", name).eq("current_version", version).gt("created_at", since);
  return (count ?? 0) > 0;
}

async function versionOf(input: Input) {
  const name = await aopName(input.name);
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

