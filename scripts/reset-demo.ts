// Puts the demo orders back where supabase/seed.sql left them, counted from today, so return windows still line up:
// Piranesi inside 30 days, The Overstory between 30 and 60, and so on. Also deletes returns started on the demo
// orders, so the same book can be returned again. Conversations, escalations and logs are kept.
// deno run -A scripts/reset-demo.ts [--remote] [--keep-returns] [--yes]
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from evals/.env (local) or evals/.env.remote (cloud).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { fromFileUrl } from "jsr:@std/path@1/from-file-url";
import { createClient } from "npm:@supabase/supabase-js@2";

// Days before today, as in seed.sql. Estimated delivery is a date; a negative number is in the future.
const ORDERS: Record<string, { placed: number; delivered: number | null; estimated: number | null }> = {
  "BK-1042": { placed: 17, delivered: 12, estimated: 12 },
  "BK-1038": { placed: 3, delivered: null, estimated: -3 },
  "BK-1051": { placed: 1, delivered: null, estimated: null },
  "BK-0987": { placed: 46, delivered: 41, estimated: 41 },
  "BK-1064": { placed: 3, delivered: 3, estimated: null },
  "BK-1060": { placed: 75, delivered: 70, estimated: 70 },
};

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const args = parseArgs(Deno.args, { boolean: ["remote", "keep-returns", "yes"] });
const envFile = `${ROOT}evals/${args.remote ? ".env.remote" : ".env"}`;
const env = Object.fromEntries(
  Deno.readTextFileSync(envFile).split("\n").map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/))
    .filter((m) => m !== null).map((m) => [m![1], m![2]]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const now = Date.now();
const ago = (days: number) => new Date(now - days * 24 * 60 * 60 * 1000).toISOString();

const { data: items, error: itemsError } = await db.from("order_items")
  .select("id, title, returns(id), orders!inner(order_number)").in("orders.order_number", Object.keys(ORDERS));
if (itemsError) fail(itemsError.message);
// An item has at most one return, so this comes back as one row or null.
const returned = items!.filter((i) => [i.returns].flat().some(Boolean));
const clearing = !args["keep-returns"] && returned.length > 0;

console.log(`On ${env.SUPABASE_URL}:`);
console.log(`- move ${Object.keys(ORDERS).length} demo orders' dates to count from today`);
if (clearing) console.log(`- delete ${returned.length} return(s): ${returned.map((i) => i.title).join(", ")}`);
if (args.remote && !args.yes && !confirm("Go ahead?")) Deno.exit(0);

for (const [order, d] of Object.entries(ORDERS)) {
  const { error } = await db.from("orders").update({
    placed_at: ago(d.placed),
    delivered_at: d.delivered === null ? null : ago(d.delivered),
    estimated_delivery: d.estimated === null ? null : ago(d.estimated).slice(0, 10),
  }).eq("order_number", order);
  if (error) fail(`${order}: ${error.message}`);
}
if (clearing) {
  const { error } = await db.from("returns").delete().in("order_item_id", returned.map((i) => i.id));
  if (error) fail(error.message);
}
console.log("Done. Piranesi and Circe are 12 days past delivery, The Overstory 41, Parable of the Sower 70.");

function fail(message: string): never {
  console.error(`Could not reset the demo data: ${message}`);
  Deno.exit(1);
}
