// One customer message, end to end: the chat must be the caller's, then the turn runs and the reply is shaped.
// The agent endpoint calls this for the app; the console calls it to run simulations against a draft AOP.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { runTurn } from "./agent.ts";
import { ESCALATED_REPLY } from "./prompts.ts";
import { Trace } from "./trace.ts";
import type { Conversation, Escalation, ToolContext } from "./types.ts";

const MAX_USER_TURNS = 20;
const CONVERSATION_COLUMNS =
  "id, user_id, status, verified_customer_id, verify_failures, current_procedure, current_version";

export interface TurnOptions {
  redteam?: boolean;
  versions?: Record<string, number>; // AOP name → version to use instead of the active one
  source?: "live" | "simulation" | "test";
}

export type TurnOutcome =
  | { ok: true; body: Record<string, unknown> & { conversation_id: string; reply: string } }
  | { ok: false; status: number; error: string };

export async function handleMessage(
  db: SupabaseClient,
  userId: string,
  conversationId: string | null | undefined,
  message: string,
  opts: TurnOptions = {},
): Promise<TurnOutcome> {
  const conv = conversationId ? await loadOwned(db, conversationId, userId) : await create(db, userId, opts.source);
  if (!conv) return { ok: false, status: 404, error: "Conversation not found" };
  const lastTurn = await lastUserTurn(db, conv.id);

  if (conv.status === "escalated") {
    return {
      ok: true,
      body: {
        conversation_id: conv.id,
        turn: lastTurn,
        reply: ESCALATED_REPLY,
        status: "escalated",
        citations: [],
        suggestions: [],
        trace: [],
        escalation: await latestEscalation(db, conv.id),
      },
    };
  }

  const turn = lastTurn + 1;
  if (turn > MAX_USER_TURNS) {
    return { ok: false, status: 429, error: "This chat has reached its message limit. Start a new chat to keep going." };
  }

  const ctx: ToolContext = {
    db,
    conv,
    trace: new Trace(await nextTraceSeq(db, conv.id)),
    redteam: opts.redteam ?? false,
    versions: opts.versions,
  };
  const { reply, citations, suggestions } = await runTurn(ctx, turn, message);
  return {
    ok: true,
    body: {
      conversation_id: conv.id,
      turn,
      reply,
      status: conv.status,
      citations,
      suggestions,
      trace: ctx.trace.forClient(),
      ...(ctx.escalation ? { escalation: ctx.escalation } : {}),
    },
  };
}

async function loadOwned(db: SupabaseClient, id: string, userId: string): Promise<Conversation | null> {
  const { data, error } = await db.from("conversations").select(CONVERSATION_COLUMNS)
    .eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  return data;
}

async function create(db: SupabaseClient, userId: string, source: TurnOptions["source"] = "live"): Promise<Conversation> {
  const { data, error } = await db.from("conversations").insert({ user_id: userId, source })
    .select(CONVERSATION_COLUMNS).single();
  if (error) throw error;
  return data;
}

async function lastUserTurn(db: SupabaseClient, conversationId: string): Promise<number> {
  const { data } = await db.from("messages").select("turn").eq("conversation_id", conversationId)
    .order("turn", { ascending: false }).limit(1).maybeSingle();
  return data?.turn ?? 0;
}

async function nextTraceSeq(db: SupabaseClient, conversationId: string): Promise<number> {
  const { data } = await db.from("trace_events").select("seq").eq("conversation_id", conversationId)
    .order("seq", { ascending: false }).limit(1).maybeSingle();
  return (data?.seq ?? 0) + 1;
}

async function latestEscalation(db: SupabaseClient, conversationId: string): Promise<Escalation | undefined> {
  const { data } = await db.from("escalations").select("summary, verified, rule_ids, customer_name")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) return undefined;
  const { customer_name, ...rest } = data;
  return customer_name ? { ...rest, customer_name } : rest;
}
