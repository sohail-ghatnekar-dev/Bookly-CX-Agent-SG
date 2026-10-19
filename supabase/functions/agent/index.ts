// POST /agent { conversation_id?, message, redteam? } → { reply, citations, suggestions, trace, … }
import { createClient } from "npm:@supabase/supabase-js@2";
import { runTurn } from "./agent.ts";
import { AnthropicError } from "./anthropic.ts";
import { ESCALATED_REPLY } from "./prompts.ts";
import { Trace } from "./trace.ts";
import type { Conversation, Escalation, ToolContext } from "./types.ts";

const MAX_MESSAGE_CHARS = 1000;
const MAX_USER_TURNS = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default;
const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // The gateway verifies the JWT (verify_jwt = true); this resolves it to a user id.
  const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  const userId = auth.user?.id;
  if (!userId) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return json({ error: `message must be 1-${MAX_MESSAGE_CHARS} characters` }, 400);
  }
  const conversationId = body?.conversation_id;
  if (conversationId !== undefined && conversationId !== null && !UUID.test(String(conversationId))) {
    return json({ error: "conversation_id must be a UUID" }, 400);
  }

  try {
    const conv = conversationId ? await loadOwned(conversationId, userId) : await create(userId);
    if (!conv) return json({ error: "Conversation not found" }, 404);
    const lastTurn = await lastUserTurn(conv.id);

    if (conv.status === "escalated") {
      return json({
        conversation_id: conv.id,
        turn: lastTurn,
        reply: ESCALATED_REPLY,
        status: "escalated",
        citations: [],
        suggestions: [],
        trace: [],
        escalation: await latestEscalation(conv.id),
      });
    }

    const turn = lastTurn + 1;
    if (turn > MAX_USER_TURNS) {
      return json({ error: "This chat has reached its message limit. Start a new chat to keep going." }, 429);
    }

    const redteam = body?.redteam === true && Deno.env.get("ALLOW_REDTEAM") === "true";
    const ctx: ToolContext = { db, conv, trace: new Trace(await nextTraceSeq(conv.id)), redteam };
    const { reply, citations, suggestions } = await runTurn(ctx, turn, message);

    return json({
      conversation_id: conv.id,
      turn,
      reply,
      status: conv.status,
      citations,
      suggestions,
      trace: ctx.trace.forClient(),
      ...(ctx.escalation ? { escalation: ctx.escalation } : {}),
    });
  } catch (err) {
    console.error("agent error:", err instanceof Error ? err.message : err);
    if (err instanceof AnthropicError) return json({ error: "The assistant is unavailable. Try again." }, 502);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
});

const CONVERSATION_COLUMNS =
  "id, user_id, status, verified_customer_id, verify_failures, current_procedure, current_version";

async function loadOwned(id: string, userId: string): Promise<Conversation | null> {
  const { data, error } = await db.from("conversations").select(CONVERSATION_COLUMNS)
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function create(userId: string): Promise<Conversation> {
  const { data, error } = await db.from("conversations").insert({ user_id: userId })
    .select(CONVERSATION_COLUMNS).single();
  if (error) throw error;
  return data;
}

async function lastUserTurn(conversationId: string): Promise<number> {
  const { data } = await db.from("messages").select("turn").eq("conversation_id", conversationId)
    .order("turn", { ascending: false }).limit(1).maybeSingle();
  return data?.turn ?? 0;
}

async function nextTraceSeq(conversationId: string): Promise<number> {
  const { data } = await db.from("trace_events").select("seq").eq("conversation_id", conversationId)
    .order("seq", { ascending: false }).limit(1).maybeSingle();
  return (data?.seq ?? 0) + 1;
}

async function latestEscalation(conversationId: string): Promise<Escalation | undefined> {
  const { data } = await db.from("escalations").select("summary, verified, rule_ids, customer_name")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return undefined;
  const { customer_name, ...rest } = data;
  return customer_name ? { ...rest, customer_name } : rest;
}
