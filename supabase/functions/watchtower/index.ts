// POST /watchtower → how the agent is doing over the last 30 days: volume, topics, handoffs, controls fired.
// Counts only, no customer details. Reads every chat, so it uses the service role, never the caller's.
import { createClient } from "npm:@supabase/supabase-js@2";
import { type ConversationRow, summarize } from "./stats.ts";

const DAYS = 30;
const MAX_CONVERSATIONS = 500;

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Any signed-in session can read the summary. A real deployment would check an admin role here.
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  if (!auth.user) return json({ error: "Unauthorized" }, 401);

  try {
    const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await db.from("conversations")
      .select(
        "id, status, current_procedure, created_at, messages(turn, role), escalations(reason, rule_ids, created_at), " +
          "trace_events(kind, label, detail, outcome, rule_id, created_at)",
      )
      .gte("created_at", since).order("created_at", { ascending: false }).limit(MAX_CONVERSATIONS);
    if (error) throw error;

    const { data: evalRun } = await db.from("eval_runs").select("model, total, passed, resolved, escalated, ran_at")
      .order("ran_at", { ascending: false }).limit(1).maybeSingle();

    return json({ ...summarize(data as unknown as ConversationRow[], DAYS), latest_eval: evalRun });
  } catch (err) {
    console.error("watchtower error:", err instanceof Error ? err.message : err);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});
