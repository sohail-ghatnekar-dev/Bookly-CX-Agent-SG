// Tool definitions and server-side execution. Every guard lives here, not in the prompt.
import type { Tool } from "./anthropic.ts";
import { evaluateReturn, type ReturnDecision, type ReturnReason } from "./policy.ts";
import type { NewEvent } from "./trace.ts";
import type { ContentBlock, ToolContext } from "./types.ts";

const MAX_VERIFY_FAILURES = 3;
const PROCEDURES = ["order_status", "returns", "policy_qa"];
const REASONS = ["damaged_defective", "changed_mind"];

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });
const returnArgs = obj({
  order_number: str("Order number, e.g. BK-1042"),
  line_code: str("Item line code from the order, e.g. BK-1042-1"),
  reason: { type: "string", enum: REASONS },
}, ["order_number", "line_code", "reason"]);

export const TOOL_DEFS: Tool[] = [
  {
    name: "select_procedure",
    description:
      "Load the procedure for the customer's current request. Call it when no procedure is active or the intent changes.",
    input_schema: obj({ name: { type: "string", enum: PROCEDURES } }, ["name"]),
  },
  {
    name: "verify_customer",
    description: "Verify identity with the account email and the ZIP code on the order.",
    input_schema: obj({ email: str("Account email"), postal_code: str("ZIP code") }, [
      "email",
      "postal_code",
    ]),
  },
  {
    name: "list_orders",
    description: "List the verified customer's orders with item line codes.",
    input_schema: obj({}),
  },
  {
    name: "get_order_status",
    description:
      "Status, carrier, tracking, delivery dates, and items with line codes for one order.",
    input_schema: obj({ order_number: str("Order number, e.g. BK-1042") }, ["order_number"]),
  },
  {
    name: "check_return_eligibility",
    description:
      "Check whether one item can be returned for a reason. Call it as soon as you know the item and the reason; don't ask the customer to confirm first. The answer is final.",
    input_schema: returnArgs,
  },
  {
    name: "initiate_return",
    description:
      "Start a return for one item that eligibility says is eligible, after confirming item and reason with the customer. Returns an RMA number.",
    input_schema: returnArgs,
  },
  {
    name: "get_policy",
    description: "Bookly policy documents: shipping, returns, refunds, account help, support hours.",
    input_schema: obj({}),
  },
  {
    name: "escalate_to_human",
    description:
      "Hand the conversation to a human teammate. When the customer pushes back on a denial or insists on something the rules don't allow, call it in the same reply where you offer a human; don't wait for them to accept.",
    input_schema: obj({
      reason: str("Short reason for the handoff"),
      summary: str(
        "Third person, max 70 words: what the customer wants, what was verified, what was tried or denied, what they ask now. Refer to them by name or as \"the customer\", not with gendered pronouns.",
      ),
    }, ["reason", "summary"]),
  },
];

// What a tool returns to the model, plus the trace event describing it.
type Result = { output: Record<string, unknown>; is_error?: boolean; event: Omit<NewEvent, "input" | "output" | "ms"> };
type Input = Record<string, unknown>;

const LABELS: Record<string, string> = { check_return_eligibility: "eligibility" };

export async function executeTool(
  ctx: ToolContext,
  use: { id: string; name: string; input: Input },
): Promise<ContentBlock> {
  const started = performance.now();
  let result: Result;
  try {
    const handler = HANDLERS[use.name];
    result = handler
      ? await handler(ctx, use.input ?? {})
      : fail({ error: "unknown_tool" }, { kind: "guard", label: "unknown_tool", detail: use.name, outcome: "error" });
  } catch (err) {
    console.error(`tool ${use.name} failed:`, err instanceof Error ? err.message : err);
    result = fail({ error: "internal_error" }, { kind: "tool", label: LABELS[use.name] ?? use.name, detail: "error", outcome: "error" });
  }
  ctx.trace.add({
    ...result.event,
    ms: Math.round(performance.now() - started),
    input: use.input,
    output: result.output,
  });
  return {
    type: "tool_result",
    tool_use_id: use.id,
    content: JSON.stringify(result.output),
    ...(result.is_error ? { is_error: true } : {}),
  };
}

const ok = (output: Record<string, unknown>, event: Result["event"]): Result => ({ output, event });
const fail = (output: Record<string, unknown>, event: Result["event"]): Result => ({
  output,
  is_error: true,
  event,
});

const HANDLERS: Record<string, (ctx: ToolContext, input: Input) => Promise<Result>> = {
  async select_procedure(ctx, input) {
    const name = String(input.name ?? "");
    if (!PROCEDURES.includes(name)) {
      return fail({ error: "unknown_procedure" }, { kind: "procedure", label: "procedure", detail: name, outcome: "error" });
    }
    const proc = await loadProcedure(ctx, name);
    await updateConversation(ctx, { current_procedure: proc.name, current_version: proc.version });
    return ok(
      { procedure: proc.name, version: proc.version, body: proc.body },
      { kind: "procedure", label: "procedure", detail: `${proc.name} v${proc.version}`, outcome: "ok" },
    );
  },

  async verify_customer(ctx, input) {
    const label = "verify_customer";
    if (ctx.conv.verified_customer_id) {
      return ok({ ok: true, already_verified: true }, { kind: "tool", label, detail: "ok", outcome: "ok" });
    }
    if (ctx.conv.verify_failures >= MAX_VERIFY_FAILURES) {
      return fail({ ok: false, locked: true }, { kind: "guard", label: "lockout", detail: "too many attempts", outcome: "blocked" });
    }
    const email = String(input.email ?? "").trim().toLowerCase();
    const zip = String(input.postal_code ?? "").trim();
    const { data: customer } = await ctx.db.from("customers").select("id, name")
      .eq("email", email).eq("postal_code", zip).maybeSingle();
    if (customer) {
      await updateConversation(ctx, { verified_customer_id: customer.id });
      return ok({ ok: true, first_name: customer.name.split(" ")[0] }, { kind: "tool", label, detail: "ok", outcome: "ok" });
    }
    const failures = ctx.conv.verify_failures + 1;
    await updateConversation(ctx, { verify_failures: failures });
    if (failures >= MAX_VERIFY_FAILURES) {
      return fail({ ok: false, locked: true }, { kind: "guard", label: "lockout", detail: `${failures} failed attempts`, outcome: "blocked" });
    }
    return ok(
      { ok: false, attempts_left: MAX_VERIFY_FAILURES - failures },
      { kind: "tool", label, detail: "failed", outcome: "denied" },
    );
  },

  async list_orders(ctx) {
    const customerId = ctx.conv.verified_customer_id;
    if (!customerId) return notVerified("list_orders");
    const { data, error } = await ctx.db.from("orders")
      .select("order_number, status, placed_at, delivered_at, order_items(line_code, title)")
      .eq("customer_id", customerId).order("placed_at", { ascending: false });
    if (error) throw error;
    const orders = data.map((o) => ({
      order: o.order_number,
      status: o.status,
      placed: o.placed_at.slice(0, 10),
      delivered: o.delivered_at?.slice(0, 10) ?? null,
      items: o.order_items.map((i: { line_code: string; title: string }) => ({ line: i.line_code, title: i.title })),
    }));
    return ok({ orders }, { kind: "tool", label: "list_orders", detail: `${orders.length} orders`, outcome: "ok" });
  },

  async get_order_status(ctx, input) {
    const customerId = ctx.conv.verified_customer_id;
    if (!customerId) return notVerified("get_order_status");
    const order = await findOrder(ctx, String(input.order_number ?? ""), customerId);
    if ("denied" in order) return order.denied;
    const o = order.row;
    const today = new Date().toISOString().slice(0, 10);
    return ok({
      order: o.order_number,
      status: o.status,
      carrier: o.carrier,
      tracking: o.tracking_number,
      est_delivery: o.estimated_delivery,
      delivered: o.delivered_at?.slice(0, 10) ?? null,
      late: o.status === "shipped" && !!o.estimated_delivery && o.estimated_delivery < today,
      items: o.order_items.map((i) => ({ line: i.line_code, title: i.title, format: i.format })),
    }, { kind: "tool", label: "get_order_status", detail: `${o.order_number} ${o.status}`, outcome: "ok" });
  },

  async check_return_eligibility(ctx, input) {
    const label = "eligibility";
    const customerId = ctx.conv.verified_customer_id;
    if (!customerId) return notVerified(label);
    const item = await findItem(ctx, input, customerId);
    if ("denied" in item) return item.denied;
    const d = item.decision;
    return ok(
      {
        eligible: d.eligible,
        rule_id: d.rule_id,
        days_since_delivery: d.days_since_delivery,
        window_days: d.window_days,
        message: d.message,
      },
      { kind: "tool", label, detail: describe(d), outcome: d.eligible ? "ok" : "denied", rule_id: d.rule_id },
    );
  },

  // Re-runs the same policy check, so calling this without the eligibility check changes nothing.
  async initiate_return(ctx, input) {
    const label = "initiate_return";
    const customerId = ctx.conv.verified_customer_id;
    if (!customerId) return notVerified(label);
    const item = await findItem(ctx, input, customerId);
    if ("denied" in item) return item.denied;
    const d = item.decision;
    if (!d.eligible) {
      return fail(
        { ok: false, blocked: true, rule_id: d.rule_id, message: d.message },
        { kind: "guard", label: "return_blocked", detail: describe(d), outcome: "blocked", rule_id: d.rule_id },
      );
    }
    const rma = `RMA-${String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0")}`;
    const { error } = await ctx.db.from("returns").insert({
      order_item_id: item.itemId,
      conversation_id: ctx.conv.id,
      reason_code: item.reason,
      rma_number: rma,
    });
    if (error?.code === "23505") {
      return fail(
        { ok: false, blocked: true, rule_id: "RET-DUPLICATE" },
        { kind: "guard", label: "return_blocked", detail: "duplicate", outcome: "blocked", rule_id: "RET-DUPLICATE" },
      );
    }
    if (error) throw error;
    const refund = await policyBody(ctx, "PAY-1");
    return ok(
      { ok: true, rma, next: "Customer ships the item back.", refund_policy: refund },
      { kind: "tool", label, detail: "RMA issued", outcome: "ok", rule_id: d.rule_id },
    );
  },

  async get_policy(ctx) {
    const { data, error } = await ctx.db.from("policy_docs").select("id, title, body").order("id");
    if (error) throw error;
    return ok({ docs: data }, { kind: "tool", label: "get_policy", detail: `${data.length} docs`, outcome: "ok" });
  },

  async escalate_to_human(ctx, input) {
    const summary = String(input.summary ?? "").trim();
    const reason = String(input.reason ?? "").trim();
    if (!summary) {
      return fail({ error: "summary_required" }, { kind: "escalation", label: "escalate_to_human", detail: "missing summary", outcome: "error" });
    }
    const { data: seen } = await ctx.db.from("trace_events").select("rule_id")
      .eq("conversation_id", ctx.conv.id).not("rule_id", "is", null);
    const ruleIds = [...new Set([...(seen ?? []), ...ctx.trace.events].map((e) => e.rule_id).filter(Boolean))] as string[];
    let customerName: string | undefined;
    if (ctx.conv.verified_customer_id) {
      const { data } = await ctx.db.from("customers").select("name").eq("id", ctx.conv.verified_customer_id).single();
      customerName = data?.name;
    }
    const escalation = {
      summary,
      verified: !!ctx.conv.verified_customer_id,
      rule_ids: ruleIds,
      ...(customerName ? { customer_name: customerName } : {}),
    };
    const { error } = await ctx.db.from("escalations").insert({
      conversation_id: ctx.conv.id,
      reason,
      ...escalation,
      customer_name: customerName ?? null,
    });
    if (error) throw error;
    await updateConversation(ctx, { status: "escalated" });
    ctx.escalation = escalation;
    return ok(
      { ok: true, reply_time: await policyBody(ctx, "HELP-1") },
      { kind: "escalation", label: "escalate_to_human", detail: "summary attached", outcome: "ok" },
    );
  },
};

// --- helpers ---

function notVerified(tool: string): Result {
  return fail(
    { error: "not_verified" },
    { kind: "guard", label: "verification_required", detail: tool, outcome: "blocked" },
  );
}

// Someone else's order gets the same answer as a missing one; only the trace differs.
function notFound(ownedByOther: boolean): Result {
  return fail(
    { error: "not_found" },
    ownedByOther
      ? { kind: "guard", label: "ownership", detail: "not owner", outcome: "denied" }
      : { kind: "tool", label: "lookup", detail: "not found", outcome: "denied" },
  );
}

interface OrderRow {
  order_number: string;
  customer_id: string;
  status: "processing" | "shipped" | "delivered" | "cancelled";
  carrier: string | null;
  tracking_number: string | null;
  estimated_delivery: string | null;
  delivered_at: string | null;
  order_items: { id: string; line_code: string; title: string; format: "hardcover" | "paperback" | "ebook" }[];
}

async function findOrder(
  ctx: ToolContext,
  orderNumber: string,
  customerId: string,
): Promise<{ row: OrderRow } | { denied: Result }> {
  const { data, error } = await ctx.db.from("orders")
    .select("order_number, customer_id, status, carrier, tracking_number, estimated_delivery, delivered_at, order_items(id, line_code, title, format)")
    .eq("order_number", orderNumber.trim().toUpperCase()).maybeSingle();
  if (error) throw error;
  if (!data || data.customer_id !== customerId) return { denied: notFound(!!data) };
  return { row: data as OrderRow };
}

async function findItem(
  ctx: ToolContext,
  input: Input,
  customerId: string,
): Promise<{ itemId: string; reason: ReturnReason; decision: ReturnDecision } | { denied: Result }> {
  const reason = String(input.reason ?? "") as ReturnReason;
  if (!REASONS.includes(reason)) {
    return { denied: fail({ error: "invalid_reason", allowed: REASONS }, { kind: "tool", label: "eligibility", detail: "invalid reason", outcome: "error" }) };
  }
  const order = await findOrder(ctx, String(input.order_number ?? ""), customerId);
  if ("denied" in order) return order;
  const lineCode = String(input.line_code ?? "").trim().toUpperCase();
  const item = order.row.order_items.find((i) => i.line_code === lineCode);
  if (!item) return { denied: notFound(false) };
  const { count } = await ctx.db.from("returns").select("id", { count: "exact", head: true })
    .eq("order_item_id", item.id);
  const decision = evaluateReturn({
    delivered_at: order.row.delivered_at ? new Date(order.row.delivered_at) : null,
    format: item.format,
    status: order.row.status,
    already_returned: (count ?? 0) > 0,
    reason,
    now: new Date(),
  });
  return { itemId: item.id, reason, decision };
}

// e.g. "denied RET-30 41/30d", "eligible RET-60 41/60d", "denied RET-DIGITAL"
function describe(d: ReturnDecision): string {
  const days = d.window_days !== null ? ` ${d.days_since_delivery}/${d.window_days}d` : "";
  return `${d.eligible ? "eligible" : "denied"} ${d.rule_id}${days}`;
}

async function loadProcedure(ctx: ToolContext, name: string) {
  const useRedteam = ctx.redteam && name === "returns";
  const query = ctx.db.from("procedures").select("name, version, body").eq("name", name);
  const { data, error } = await (useRedteam ? query.eq("is_redteam", true) : query.eq("is_active", true))
    .order("version", { ascending: false }).limit(1).single();
  if (error) throw error;
  return data as { name: string; version: number; body: string };
}

async function policyBody(ctx: ToolContext, id: string): Promise<string> {
  const { data } = await ctx.db.from("policy_docs").select("body").eq("id", id).single();
  return data?.body ?? "";
}

async function updateConversation(ctx: ToolContext, patch: Partial<ToolContext["conv"]>) {
  const { error } = await ctx.db.from("conversations").update(patch).eq("id", ctx.conv.id);
  if (error) throw error;
  Object.assign(ctx.conv, patch);
}
