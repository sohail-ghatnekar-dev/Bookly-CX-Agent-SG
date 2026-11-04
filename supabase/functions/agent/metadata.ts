// {{ metadata }} in AOP text: facts about the customer, filled in each time the agent reads the AOP. Before the
// customer is verified, anything about their account reads "unknown".
import type { ToolContext } from "./types.ts";

export const METADATA = [
  { key: "customer.first_name", description: "The customer's first name, once verified" },
  { key: "customer.verified", description: "\"yes\" once the order number and email match" },
  { key: "customer.order_count", description: "How many orders are on their account" },
  { key: "customer.open_orders", description: "Orders not delivered yet" },
  { key: "customer.is_new", description: "\"yes\" if this is their first order with Bookly" },
  { key: "channel", description: "Where they're talking to us: chat, email or voice" },
];

export const METADATA_REF = /\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g;

// Fills an AOP's {{ metadata }}, looking the customer up only when the AOP uses any.
export async function render(ctx: ToolContext, body: string): Promise<string> {
  return body.includes("{{") ? fill(body, await metadataFor(ctx)) : body;
}

// Replaces every {{ key }} with its value; a key without one reads "unknown".
export function fill(body: string, values: Record<string, string>): string {
  return body.replace(METADATA_REF, (_, key: string) => values[key] ?? "unknown");
}

export async function metadataFor(ctx: ToolContext): Promise<Record<string, string>> {
  const values: Record<string, string> = { channel: "chat", "customer.verified": "no" };
  const id = ctx.conv.verified_customer_id;
  if (!id) return values;
  const { data } = await ctx.db.from("customers").select("name, orders(status)").eq("id", id).single();
  if (!data) return values;
  const orders = (data.orders ?? []) as { status: string }[];
  return {
    ...values,
    "customer.verified": "yes",
    "customer.first_name": data.name.split(" ")[0],
    "customer.order_count": String(orders.length),
    "customer.open_orders": String(orders.filter((o) => o.status === "processing" || o.status === "shipped").length),
    "customer.is_new": orders.length <= 1 ? "yes" : "no",
  };
}
