// One customer turn: model loop, tool execution, post-checks, persistence.
import { createMessage } from "./anthropic.ts";
import { buildSystemPrompt, FALLBACK_REPLY, type ProcedureRef, REFUSAL_REPLY } from "./prompts.ts";
import { suggestReplies } from "./suggest.ts";
import { executeTool, TOOL_DEFS } from "./tools.ts";
import type { ContentBlock, Message, ToolContext } from "./types.ts";

const MAX_STEPS = 6;
const SOURCES_LINE = /\n?[ \t]*Sources?:([^\n]*)$/;
const DOC_ID = /\b[A-Z]{2,}-[A-Z0-9]+\b/g;
// The spec's claim pattern, except that a negation or modal around the noun and verb
// ("returns must be started within 30 days", "no return has been started") reads as a rule, not a claim.
const CLAIM =
  /(?<!\bno\s+)(return|refund)(?:(?!\b(?:must|can|cannot|will|would|should|could|be|not|never)\b|n't\b)[^.])*\b(approved|initiated|started|processed|issued|created)\b|\bRMA-\d+/i;

export interface TurnResult {
  reply: string;
  citations: string[];
  suggestions: string[];
}

export async function runTurn(ctx: ToolContext, turn: number, userText: string): Promise<TurnResult> {
  const { db, conv, trace } = ctx;
  const history = await loadHistory(ctx);
  const index = await loadProcedureIndex(ctx);
  const added: Message[] = [{ role: "user", content: [{ type: "text", text: userText }] }];

  let reply = "";
  for (let step = 0; step < MAX_STEPS && !reply; step++) {
    const system = buildSystemPrompt(index, await currentProcedure(ctx), !!conv.verified_customer_id);
    const res = await createMessage(system, mergeRoles([...history, ...added]), TOOL_DEFS);
    const toolUses = res.content.filter((b) => b.type === "tool_use");

    if (res.stop_reason === "refusal") {
      trace.add({ kind: "guard", label: "refusal", detail: "model declined", outcome: "blocked" });
      reply = REFUSAL_REPLY;
      added.push({ role: "assistant", content: [{ type: "text", text: reply }] });
    } else if (res.stop_reason === "tool_use" && toolUses.length > 0) {
      added.push({ role: "assistant", content: res.content });
      const results: ContentBlock[] = [];
      for (const use of toolUses) results.push(await executeTool(ctx, use));
      added.push({ role: "user", content: results });
    } else {
      // Keep text only: a reply cut off by max_tokens can end in a tool_use that will never get a result.
      reply = textOf(res.content) || FALLBACK_REPLY;
      added.push({ role: "assistant", content: [{ type: "text", text: reply }] });
    }
  }
  if (!reply) {
    trace.add({ kind: "guard", label: "step_limit", detail: `${MAX_STEPS} steps`, outcome: "error" });
    reply = FALLBACK_REPLY;
    added.push({ role: "assistant", content: [{ type: "text", text: reply }] });
  }

  const { text, citations } = await checkSources(ctx, reply);
  await checkClaims(ctx, text);
  await persist(ctx, turn, history.length, added);
  return { reply: text, citations, suggestions: await suggestionsFor(ctx, text) };
}

async function suggestionsFor(ctx: ToolContext, reply: string): Promise<string[]> {
  const { data, error } = await ctx.db.from("trace_events").select("label, outcome, rule_id, output")
    .eq("conversation_id", ctx.conv.id).in("label", ["eligibility", "initiate_return", "list_orders"]).order("seq");
  if (error) throw error;
  return suggestReplies({
    reply,
    procedure: ctx.conv.current_procedure,
    verified: !!ctx.conv.verified_customer_id,
    escalated: ctx.conv.status === "escalated",
    events: data,
  });
}

// (a) Strip the trailing Sources line; cite IDs that exist in policy_docs, flag ones that don't.
async function checkSources(ctx: ToolContext, reply: string) {
  const match = reply.match(SOURCES_LINE);
  if (!match) return { text: reply, citations: [] as string[] };
  const text = reply.slice(0, match.index).trimEnd();
  // Only ID-shaped tokens count; a prose line like "Sources: none cover this" cites nothing.
  const ids = [...new Set(match[1].match(DOC_ID) ?? [])];
  if (!ids.length) return { text, citations: [] as string[] };
  const { data } = await ctx.db.from("policy_docs").select("id").in("id", ids);
  const known = new Set((data ?? []).map((d) => d.id));
  const citations = ids.filter((id) => known.has(id));
  const invalid = ids.filter((id) => !known.has(id));
  if (citations.length) {
    ctx.trace.add({ kind: "grounding", label: "sources", detail: citations.join(", "), outcome: "ok", output: citations });
  }
  if (invalid.length) {
    ctx.trace.add({ kind: "guard", label: "invalid_citation", detail: invalid.join(", "), outcome: "flagged", output: invalid });
  }
  return { text, citations };
}

// (b) A reply that claims a return happened needs a successful initiate_return somewhere in this conversation.
async function checkClaims(ctx: ToolContext, text: string) {
  if (!CLAIM.test(text)) return;
  const thisTurn = ctx.trace.events.some((e) => e.label === "initiate_return" && e.outcome === "ok");
  if (thisTurn) return;
  const { count } = await ctx.db.from("trace_events").select("id", { count: "exact", head: true })
    .eq("conversation_id", ctx.conv.id).eq("label", "initiate_return").eq("outcome", "ok");
  if ((count ?? 0) > 0) return;
  ctx.trace.add({ kind: "guard", label: "unsupported_claim", detail: "return claim without RMA", outcome: "flagged", output: text });
}

async function loadHistory(ctx: ToolContext): Promise<Message[]> {
  const { data, error } = await ctx.db.from("messages").select("role, content")
    .eq("conversation_id", ctx.conv.id).order("seq");
  if (error) throw error;
  return data as Message[];
}

async function persist(ctx: ToolContext, turn: number, firstSeq: number, added: Message[]) {
  const messages = added.map((m, i) => ({
    conversation_id: ctx.conv.id,
    seq: firstSeq + i,
    turn,
    role: m.role,
    content: m.content,
  }));
  const { error } = await ctx.db.from("messages").insert(messages);
  if (error) throw error;
  if (ctx.trace.events.length) {
    const { error: traceError } = await ctx.db.from("trace_events").insert(ctx.trace.rows(ctx.conv.id, turn));
    if (traceError) throw traceError;
  }
}

async function loadProcedureIndex(ctx: ToolContext): Promise<ProcedureRef[]> {
  const { data, error } = await ctx.db.from("procedures").select("name, version, body")
    .eq("is_active", true).order("name");
  if (error) throw error;
  return data;
}

// A red-team version stays current only while the request is allowed to use it.
async function currentProcedure(ctx: ToolContext): Promise<ProcedureRef | null> {
  const { current_procedure: name, current_version: version } = ctx.conv;
  if (!name || version === null) return null;
  const { data } = await ctx.db.from("procedures").select("name, version, body, is_redteam")
    .eq("name", name).eq("version", version).single();
  if (data && (!data.is_redteam || ctx.redteam)) return data;
  const { data: active } = await ctx.db.from("procedures").select("name, version, body")
    .eq("name", name).eq("is_active", true).single();
  return active;
}

// A turn that hit the step limit ends on tool results, so the next user text can follow a user message.
function mergeRoles(messages: Message[]): Message[] {
  const merged: Message[] = [];
  for (const m of messages) {
    const last = merged.at(-1);
    if (last?.role === m.role) last.content = [...last.content, ...m.content];
    else merged.push({ role: m.role, content: [...m.content] });
  }
  return merged;
}

function textOf(content: ContentBlock[]): string {
  return content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
}
