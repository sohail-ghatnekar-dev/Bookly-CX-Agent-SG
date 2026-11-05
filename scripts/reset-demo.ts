// Puts the demo orders back where supabase/seed.sql left them, counted from today, so return windows still line up:
// Piranesi inside 30 days, The Overstory between 30 and 60, and so on. Also deletes returns started on the demo
// orders, so the same book can be returned again, and their follow-ups, so a late order can be scheduled again.
// AOPs go back to the seeded versions: any version made in the console (a new AOP, a draft, a publish) is deleted
// with its simulations and audit rows, and each AOP's newest seeded version is live again, undoing rollbacks.
// Conversations, escalations and logs are kept.
// deno run -A scripts/reset-demo.ts [--remote] [--keep-returns] [--keep-aops] [--yes]
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
  "BK-1072": { placed: 9, delivered: null, estimated: 3 }, // shipped, 3 days late: the late-orders demo
};

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const args = parseArgs(Deno.args, { boolean: ["remote", "keep-returns", "keep-aops", "yes"] });
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
const { data: followUps, error: followUpsError } = await db.from("follow_ups").select("id, order_number")
  .in("order_number", Object.keys(ORDERS));
if (followUpsError) fail(followUpsError.message);

// Seeded versions are authored by Bookly CX; everything else came from the console.
const SEEDED = "Bookly CX";
const { data: versions, error: versionsError } = await db.from("procedures")
  .select("name, version, author, is_active, published_at").eq("is_redteam", false);
if (versionsError) fail(versionsError.message);
const made = args["keep-aops"] ? [] : versions!.filter((v) => v.author !== SEEDED);
const isMade = (name: string, version: number | null) => made.some((v) => v.name === name && v.version === version);
// The version each seeded AOP should have live: its newest published seeded version.
const restore = args["keep-aops"] ? [] : [...new Set(versions!.filter((v) => v.author === SEEDED).map((v) => v.name))].flatMap((name) => {
  const target = versions!.filter((v) => v.name === name && v.author === SEEDED && v.published_at)
    .sort((a, b) => b.version - a.version)[0];
  const live = versions!.find((v) => v.name === name && v.is_active);
  return target && live?.version !== target.version ? [{ name, from: live?.version ?? null, to: target.version }] : [];
});
const { data: events, error: eventsError } = args["keep-aops"] ? { data: [], error: null }
  : await db.from("aop_events").select("id, procedure, version, action").neq("actor", SEEDED);
if (eventsError) fail(eventsError.message);
// Console rows go, except simulation runs on seeded versions, which Test sets shows as each AOP's last run.
const staleEvents = events!.filter((e) => isMade(e.procedure, e.version) || e.action !== "simulation_run");

console.log(`On ${env.SUPABASE_URL}:`);
console.log(`- move ${Object.keys(ORDERS).length} demo orders' dates to count from today`);
if (clearing) console.log(`- delete ${returned.length} return(s): ${returned.map((i) => i.title).join(", ")}`);
if (followUps!.length) console.log(`- delete ${followUps!.length} follow-up(s): ${[...new Set(followUps!.map((f) => f.order_number))].join(", ")}`);
if (made.length) console.log(`- delete ${made.length} AOP version(s) made in the console: ${made.map((v) => `${v.name} v${v.version}`).join(", ")}`);
for (const r of restore) console.log(`- make ${r.name} v${r.to} live again${r.from === null ? "" : ` (now v${r.from})`}`);
if (staleEvents.length) console.log(`- delete ${staleEvents.length} audit row(s) from the console`);
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
if (followUps!.length) {
  const { error } = await db.from("follow_ups").delete().in("id", followUps!.map((f) => f.id));
  if (error) fail(error.message);
}
for (const name of new Set(made.map((v) => v.name))) {
  const versionsOf = made.filter((v) => v.name === name).map((v) => v.version);
  const runs = await db.from("simulation_runs").delete().eq("procedure", name).in("version", versionsOf); // results cascade
  if (runs.error) fail(runs.error.message);
  const { error } = await db.from("procedures").delete().eq("name", name).in("version", versionsOf);
  if (error) fail(`${name}: ${error.message}`);
}
// One live version per AOP (a unique index enforces it), so the current one goes off first.
for (const r of restore) {
  const off = await db.from("procedures").update({ is_active: false }).eq("name", r.name).eq("is_active", true);
  if (off.error) fail(off.error.message);
  const { error } = await db.from("procedures").update({ is_active: true }).eq("name", r.name).eq("version", r.to);
  if (error) fail(`${r.name}: ${error.message}`);
}
if (staleEvents.length) {
  const { error } = await db.from("aop_events").delete().in("id", staleEvents.map((e) => e.id));
  if (error) fail(error.message);
}
console.log("Done. Piranesi and Circe are 12 days past delivery, The Overstory 41, Parable of the Sower 70; BK-1072 is 3 days late.");

function fail(message: string): never {
  console.error(`Could not reset the demo data: ${message}`);
  Deno.exit(1);
}
