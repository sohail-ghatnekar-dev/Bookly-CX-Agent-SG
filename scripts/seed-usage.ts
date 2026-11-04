// Fills the last 30 days with generated demo usage (about 1,250 chats), so Home, Insights and Watchtowers have
// something to show. Every row it writes is marked synthetic, and each run replaces the previous one's.
// deno run -A scripts/seed-usage.ts [--remote] [--count 1250] [--clear] [--yes]
//   --clear  only remove the generated usage
// Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from evals/.env (local) or evals/.env.remote (cloud).
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { fromFileUrl } from "jsr:@std/path@1/from-file-url";
import { createClient } from "npm:@supabase/supabase-js@2";

const ROOT = fromFileUrl(new URL("..", import.meta.url));
const args = parseArgs(Deno.args, { boolean: ["remote", "clear", "yes"], string: ["count"] });
const COUNT = Number(args.count ?? 1250);
const DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;
const BATCH = 500;
const SIM_USER = "usage-generator@bookly.test";

const env = Object.fromEntries(
  Deno.readTextFileSync(`${ROOT}evals/${args.remote ? ".env.remote" : ".env"}`).split("\n")
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter((m) => m !== null).map((m) => [m![1], m![2]]),
);
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// --- random, but the same every run ---
let seed = 20261103;
function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const chance = (p: number) => rand() < p;
const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
function weighted<T>(options: [T, number][]): T {
  let r = rand() * options.reduce((a, [, w]) => a + w, 0);
  for (const [v, w] of options) if ((r -= w) < 0) return v;
  return options[0][0];
}

const FIRST = ["Ava", "Ben", "Chloe", "Dev", "Elena", "Femi", "Grace", "Hiro", "Isla", "Jonah", "Kemi", "Leo", "Mira", "Noah", "Olu", "Priya", "Quinn", "Rosa", "Sam", "Tara", "Uma", "Victor", "Wen", "Yara", "Zoe"];
const LAST = ["Adler", "Brooks", "Castillo", "Dunn", "Evans", "Farah", "Gupta", "Hale", "Ibarra", "Jensen", "Kim", "Lopez", "Moreau", "Nakamura", "Okoro", "Patel", "Reyes", "Silva", "Turner", "Varga", "Walsh", "Young"];
const BOOKS = ["Tomorrow, and Tomorrow, and Tomorrow", "The Midnight Library", "Lessons in Chemistry", "Project Hail Mary", "Demon Copperhead", "The Covenant of Water", "Klara and the Sun", "Fourth Wing", "Remarkably Bright Creatures", "The Seven Husbands of Evelyn Hugo", "Cloud Cuckoo Land", "The Lincoln Highway", "Babel", "Sea of Tranquility", "Educated", "Atomic Habits"];
const CARRIERS = ["UPS", "USPS", "FedEx"];

type Rating = [number, number, number, number, number]; // weights for 1..5 stars
const HAPPY: Rating = [2, 3, 8, 25, 62];
const OK_NO: Rating = [5, 12, 30, 33, 20];
const HANDED_OFF: Rating = [12, 18, 30, 25, 15];
const UNHAPPY: Rating = [35, 30, 20, 10, 5];

interface Ev { kind: string; label: string; detail: string; outcome: string; rule_id?: string | null; input?: unknown; output?: unknown }
interface Turn { user: string; agent: string; events: Ev[] }
interface Chat {
  topic: string;
  procedure: string | null;
  verified: boolean;
  failures: number;
  turns: Turn[];
  handoff?: { reason: string; summary: string; rules: string[] };
  rating: Rating;
  followUp?: boolean; // likely to write in again about the same thing
}

interface Customer { id: string; first: string; name: string; email: string }

// --- one chat per topic, with the outcomes Bookly would see ---
function verifyTurns(c: Customer, order: string, opener: string, ask: string): { turns: Turn[]; failures: number } {
  const turns: Turn[] = [];
  let failures = 0;
  const tries = weighted([[0, 90], [1, 6], [2, 4]]);
  turns.push({ user: opener, agent: ask, events: [] });
  for (let i = 0; i < tries; i++) {
    failures++;
    turns.push({
      user: `${order}, ${c.email.replace("@", ".mail@")}`,
      agent: "I couldn't match those details to an order. Could you check the order number and the email you used?",
      events: [{ kind: "tool", label: "verify_customer", detail: "failed", outcome: "denied", input: { order_number: order }, output: { ok: false } }],
    });
  }
  return { turns, failures };
}

function verified(order: string, c: Customer): Ev {
  return { kind: "tool", label: "verify_customer", detail: "ok", outcome: "ok", input: { order_number: order, email: c.email }, output: { ok: true, first_name: c.first } };
}

const generators: [string, number, (c: Customer) => Chat][] = [
  ["Order tracking", 28, (c) => {
    const order = `BK-${int(2000, 8999)}`;
    const book = pick(BOOKS);
    const carrier = pick(CARRIERS);
    const status = weighted([["shipped", 70], ["processing", 20], ["delivered", 10]]);
    const v = verifyTurns(c, order, pick(["Where's my order?", "Has my order shipped yet?", "Can you check on my order?"]), "Happy to check. What's the order number and the email on the order?");
    const reply = status === "shipped"
      ? `Thanks, ${c.first}. ${book} shipped with ${carrier} and should arrive in ${int(1, 4)} days. Tracking: 1Z${int(100000, 999999)}.`
      : status === "processing" ? `Thanks, ${c.first}. ${book} is being packed and ships within 1 business day.` : `Thanks, ${c.first}. ${book} was delivered ${int(1, 5)} days ago.`;
    return {
      topic: "Order tracking", procedure: "order_status", verified: true, failures: v.failures, rating: HAPPY,
      turns: [...v.turns, {
        user: `${order}, ${c.email}`, agent: reply,
        events: [verified(order, c), { kind: "tool", label: "get_order_status", detail: `${order} ${status}`, outcome: "ok", input: { order_number: order }, output: { status, carrier, late: false } }],
      }],
    };
  }],
  ["Late delivery", 9, (c) => {
    const order = `BK-${int(2000, 8999)}`;
    const days = int(2, 9);
    const v = verifyTurns(c, order, pick(["My order still hasn't arrived", "My book was supposed to be here days ago", "Where is my package? It's late"]), "Sorry about that. What's the order number and the email on the order?");
    const escalate = chance(0.55);
    const chat: Chat = {
      topic: "Late delivery", procedure: "order_status", verified: true, failures: v.failures, rating: escalate ? HANDED_OFF : UNHAPPY, followUp: !escalate,
      turns: [...v.turns, {
        user: `${order}, ${c.email}`,
        agent: `Thanks, ${c.first}. It shipped with ${pick(CARRIERS)} but it's ${days} days past its estimated delivery. I can send this to a Bookly employee to look into it.`,
        events: [verified(order, c), { kind: "tool", label: "get_order_status", detail: `${order} shipped late`, outcome: "ok", input: { order_number: order }, output: { status: "shipped", late: true } }],
      }],
    };
    if (escalate) {
      chat.turns.push({
        user: "Yes please, I need it this week",
        agent: "Done. A Bookly employee has your case and will reply within 1 business day.",
        events: [{ kind: "escalation", label: "escalate_to_human", detail: "summary attached", outcome: "ok" }],
      });
      chat.handoff = { reason: "Order past its estimated delivery date", summary: `${c.name}'s order ${order} is ${days} days past its estimated delivery. Verified. Wants it this week.`, rules: [] };
    }
    return chat;
  }],
  ["Change-of-mind return", 17, (c) => returnChat(c, "changed_mind")],
  ["Damaged or defective item", 10, (c) => returnChat(c, "damaged_defective")],
  ["Ebook return", 4, (c) => {
    const order = `BK-${int(2000, 8999)}`;
    const book = pick(BOOKS);
    const v = verifyTurns(c, order, `I'd like to return the ebook of ${book}`, "I can look into that. What's the order number and the email on the order?");
    const escalate = chance(0.25);
    const chat: Chat = {
      topic: "Ebook return", procedure: "returns", verified: true, failures: v.failures, rating: escalate ? HANDED_OFF : OK_NO,
      turns: [...v.turns, {
        user: `${order}, ${c.email}`,
        agent: "Thanks. Ebooks are digital purchases, so they can't be returned. Is there anything else I can help with?",
        events: [verified(order, c), { kind: "tool", label: "eligibility", detail: "denied RET-DIGITAL", outcome: "denied", rule_id: "RET-DIGITAL", input: { order_number: order, reason: "changed_mind" }, output: { eligible: false, rule_id: "RET-DIGITAL" } }],
      }],
    };
    if (escalate) handOff(chat, c, "Ebook return requested; ebooks are not returnable", ["RET-DIGITAL"]);
    return chat;
  }],
  ["Shipping questions", 14, () => policyChat("Shipping questions", pick([
    ["How long does shipping take?", "US standard shipping takes 3-5 business days, and it's free on orders over $35.", "SHIP-1"],
    ["Do you ship to Canada?", "Yes. Shipping to Canada takes 7-14 business days, and duties are paid by the recipient.", "SHIP-2"],
    ["When will my order ship?", "Orders ship within 1 business day, and we email a tracking number when it does.", "SHIP-3"],
  ]))],
  ["Refunds and payments", 8, () => policyChat("Refunds and payments", pick([
    ["When will I get my refund?", "Refunds go to your original payment method within 5-7 business days after we receive the return.", "PAY-1"],
    ["Where does my refund go?", "Back to the original payment method, within 5-7 business days of us receiving the item.", "PAY-1"],
  ]))],
  ["Account and password", 6, (c) => {
    const chat = policyChat("Account and password", ["I can't log in", "You can reset your password from \"Forgot password\" on the sign-in page. The link is emailed to you and lasts 1 hour.", "ACC-1"]);
    if (chance(0.12)) handOff(chat, c, "Reset email not arriving", []);
    return chat;
  }],
  ["Other", 4, (c) => {
    const ask = pick(["Do you price match?", "Can I change the address on my order?", "Do you sell gift cards?", "Can I pre-order a book?"]);
    const chat: Chat = {
      topic: "Other", procedure: null, verified: false, failures: 0, rating: OK_NO,
      turns: [{ user: ask, agent: "I don't have that information here. Should I send this to a Bookly employee?", events: [] }],
    };
    if (chance(0.55)) handOff(chat, c, "Question outside what the agent can answer", []);
    return chat;
  }],
];

function returnChat(c: Customer, reason: "changed_mind" | "damaged_defective"): Chat {
  const order = `BK-${int(2000, 8999)}`;
  const book = pick(BOOKS);
  const damaged = reason === "damaged_defective";
  const rule = damaged ? "RET-60" : "RET-30";
  const window = damaged ? 60 : 30;
  const eligible = chance(damaged ? 0.85 : 0.62);
  const days = eligible ? int(2, window - 1) : int(window + 1, window + 40);
  const opener = damaged ? `${book} arrived ${pick(["with a torn cover", "with water damage", "with missing pages"])}` : `I'd like to return ${book}`;
  const v = verifyTurns(c, order, opener, "Sorry to hear that. What's the order number and the email on the order?");
  const look: Ev = { kind: "tool", label: "get_order_status", detail: `${order} delivered`, outcome: "ok", input: { order_number: order }, output: { status: "delivered" } };
  const check: Ev = {
    kind: "tool", label: "eligibility", detail: `${eligible ? "eligible" : "denied"} ${rule} ${days}/${window}d`, outcome: eligible ? "ok" : "denied", rule_id: rule,
    input: { order_number: order, reason }, output: { eligible, rule_id: rule, days_since_delivery: days, window_days: window },
  };
  const topic = damaged ? "Damaged or defective item" : "Change-of-mind return";
  const chat: Chat = { topic, procedure: "returns", verified: true, failures: v.failures, rating: HAPPY, turns: [...v.turns] };

  if (eligible) {
    chat.turns.push({ user: `${order}, ${c.email}${damaged ? "" : ". I changed my mind"}`, agent: `Thanks, ${c.first}. ${book} can be returned. Shall I start the return?`, events: [verified(order, c), look, check] });
    if (chance(0.015)) {
      // The agent said the return was started without starting it: the claim check flags it.
      chat.turns.push({ user: "Yes", agent: "Your return has been started. You'll get an email shortly.", events: [{ kind: "guard", label: "unsupported_claim", detail: "return claim without RMA", outcome: "flagged" }] });
      chat.rating = UNHAPPY;
      chat.followUp = true;
    } else if (chance(0.88)) {
      const rma = `RMA-${String(int(0, 999999)).padStart(6, "0")}`;
      chat.turns.push({
        user: "Yes please",
        agent: `Done. Your return number is ${rma}. Ship the book back and your refund follows within 5-7 business days of it arriving.`,
        events: [{ kind: "tool", label: "initiate_return", detail: "RMA issued", outcome: "ok", rule_id: rule, input: { order_number: order, reason }, output: { ok: true, rma } }],
      });
    } else {
      // The customer left before confirming: eligible, but no RMA.
      chat.rating = UNHAPPY;
      chat.followUp = true;
    }
    return chat;
  }

  chat.turns.push({
    user: `${order}, ${c.email}${damaged ? "" : ". I changed my mind"}`,
    agent: `Thanks, ${c.first}. It's been ${days} days since delivery, and ${damaged ? "damaged items" : "change-of-mind returns"} can be returned within ${window} days, so I can't start this one.`,
    events: [verified(order, c), look, check],
  });
  chat.rating = OK_NO;
  if (chance(damaged ? 0.6 : 0.45)) {
    chat.turns.push({ user: pick(["That's not fair, I want a refund", "Just do it anyway", "Can you make an exception?"]), agent: "", events: [] });
    handOff(chat, c, damaged ? "Damaged item reported after the 60-day window" : "Return requested outside 30-day window (change of mind)", [rule], true);
  }
  return chat;
}

function policyChat(topic: string, [ask, answer, doc]: string[]): Chat {
  const cited = chance(0.01) ? "SHIP-9" : doc; // now and then the agent cites a document that doesn't exist
  return {
    topic, procedure: "policy_qa", verified: false, failures: 0, rating: cited === doc ? HAPPY : OK_NO,
    turns: [{
      user: ask, agent: answer,
      events: [
        { kind: "tool", label: "get_policy", detail: "10 docs", outcome: "ok" },
        cited === doc
          ? { kind: "grounding", label: "sources", detail: doc, outcome: "ok", output: [doc] }
          : { kind: "guard", label: "invalid_citation", detail: cited, outcome: "flagged", output: [cited] },
      ],
    }],
  };
}

// The last turn's reply becomes the handoff message, with the escalation event on it.
function handOff(chat: Chat, c: Customer, reason: string, rules: string[], sameTurn = false) {
  const reply = "I understand. I've sent this to a Bookly employee with everything so far, and they'll reply within 1 business day.";
  const event: Ev = { kind: "escalation", label: "escalate_to_human", detail: "summary attached", outcome: "ok" };
  if (sameTurn && chat.turns.at(-1)!.agent === "") {
    chat.turns.at(-1)!.agent = reply;
    chat.turns.at(-1)!.events.push(event);
  } else {
    chat.turns.push({ user: "Yes, please", agent: reply, events: [event] });
  }
  chat.handoff = { reason, summary: `${chat.verified ? c.name : "The customer"}: ${reason.toLowerCase()}.`, rules };
  chat.rating = HANDED_OFF;
}

// --- writing it ---
async function insert(table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await db.from(table).insert(rows.slice(i, i + BATCH));
    if (error) fail(`${table}: ${error.message}`);
  }
}

async function clear() {
  const { error } = await db.from("conversations").delete().eq("synthetic", true);
  if (error) fail(`conversations: ${error.message}`);
  const { error: e2 } = await db.from("customers").delete().eq("synthetic", true);
  if (e2) fail(`customers: ${e2.message}`);
}

async function simUser(): Promise<string> {
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const found = data?.users.find((u) => u.email === SIM_USER);
  if (found) return found.id;
  const password = crypto.randomUUID() + crypto.randomUUID(); // never used to sign in
  const { data: created, error } = await db.auth.admin.createUser({ email: SIM_USER, password, email_confirm: true });
  if (error) fail(`user: ${error.message}`);
  return created.user!.id;
}

function fail(message: string): never {
  console.error(`Could not write the demo usage: ${message}`);
  Deno.exit(1);
}

console.log(`On ${env.SUPABASE_URL}:`);
console.log(args.clear ? "- remove all generated demo usage" : `- replace generated demo usage with ${COUNT} chats over the last ${DAYS} days`);
if (args.remote && !args.yes && !confirm("Go ahead?")) Deno.exit(0);

await clear();
if (args.clear) {
  console.log("Removed.");
  Deno.exit(0);
}

const userId = await simUser();
const { data: live } = await db.from("procedures").select("name, version").eq("is_active", true);
const liveVersion = Object.fromEntries((live ?? []).map((p) => [p.name, p.version]));

const customers: Customer[] = Array.from({ length: 1100 }, (_, i) => {
  const first = pick(FIRST);
  const last = pick(LAST);
  return { id: crypto.randomUUID(), first, name: `${first} ${last}`, email: `${first}.${last}.${i}@example.com`.toLowerCase() };
});
await insert("customers", customers.map((c) => ({ id: c.id, email: c.email, name: c.name, postal_code: String(int(10000, 99999)), synthetic: true })));

// More chats on weekdays and toward today, as volume grows.
const now = Date.now();
const dayWeights = Array.from({ length: DAYS }, (_, d) => {
  const date = new Date(now - (DAYS - 1 - d) * DAY);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  return (0.8 + 0.4 * (d / (DAYS - 1))) * (weekend ? 0.7 : 1) * (0.9 + 0.2 * rand());
});
// Through the day on a weighted day, busiest mid-morning Pacific time; a time that hasn't happened yet is drawn again.
const PT_HOURS = [2, 2, 1, 3, 8, 13, 17, 21, 22, 23, 26, 22, 21, 22, 20, 18, 17, 18, 13, 11, 8, 4, 3, 2];
function when(): number {
  for (;;) {
    const d = weighted(dayWeights.map((w, i) => [i, w]));
    const hour = weighted(PT_HOURS.map((w, h) => [h, w]));
    const start = new Date(now - (DAYS - 1 - d) * DAY);
    start.setUTCHours(0, 0, 0, 0);
    const at = start.getTime() + (hour + 8 + rand()) * 60 * 60 * 1000; // Pacific is UTC-8 (UTC-7 in summer)
    if (at < now - 5 * 60 * 1000) return at;
  }
}

// Many customers ask something else or say thanks before they go, so chats run longer than their main question.
const EXTRA: [string, string][] = [
  ["Thanks!", "You're welcome. Happy reading!"],
  ["Do you ship to Canada?", "Yes. Shipping to Canada takes 7-14 business days, and duties are paid by the recipient."],
  ["How long do refunds take?", "Refunds arrive within 5-7 business days after we receive the return."],
  ["Can I change my password from the app?", "Yes: use \"Forgot password\" on the sign-in page and we'll email you a link."],
  ["When do you usually ship?", "Orders ship within 1 business day."],
  ["Ok, one more thing", "Of course. What else can I help with?"],
];
function addExtras(chat: Chat) {
  const extra = weighted([[0, 50], [1, 22], [2, 10], [3, 7], [4, 4], [5, 3], [6, 2], [8, 1], [10, 1]]);
  if (chat.handoff) return; // after a handoff the chat is with an employee
  for (let i = 0; i < extra; i++) {
    const [user, agent] = i === extra - 1 ? EXTRA[0] : pick(EXTRA.slice(1));
    chat.turns.push({ user, agent, events: [] });
  }
}

const planned: { chat: Chat; customer: Customer; at: number }[] = [];
for (let i = 0; i < COUNT; i++) {
  const customer = pick(customers);
  const make = weighted(generators.map(([, w, g]) => [g, w]));
  const chat = make(customer);
  addExtras(chat);
  const at = when();
  planned.push({ chat, customer, at });
  // Some customers whose problem wasn't solved write in again about it within a few days.
  if (chat.followUp && chance(0.35)) {
    const again = at + int(1, 5) * DAY + rand() * DAY;
    if (again < now) {
      const follow = make(customer);
      planned.push({ chat: { ...follow, topic: chat.topic }, customer, at: again });
    }
  }
}

const conversations: Record<string, unknown>[] = [];
const messages: Record<string, unknown>[] = [];
const events: Record<string, unknown>[] = [];
const escalations: Record<string, unknown>[] = [];
for (const { chat, customer, at } of planned) {
  const id = crypto.randomUUID();
  const rated = chance(0.58);
  conversations.push({
    id, user_id: userId, source: "live", synthetic: true, topic: chat.topic,
    status: chat.handoff ? "escalated" : "active",
    verified_customer_id: chat.verified ? customer.id : null,
    verify_failures: chat.failures,
    current_procedure: chat.procedure,
    current_version: chat.procedure ? liveVersion[chat.procedure] ?? 1 : null,
    csat: rated ? weighted(chat.rating.map((w, i) => [i + 1, w])) : null,
    created_at: new Date(at).toISOString(),
  });
  let seq = 0;
  let traceSeq = 1;
  chat.turns.forEach((t, i) => {
    const turn = i + 1;
    const time = new Date(at + i * 45_000).toISOString();
    messages.push({ conversation_id: id, seq: seq++, turn, role: "user", content: [{ type: "text", text: t.user }] });
    if (i === 0 && chat.procedure) {
      events.push({ conversation_id: id, turn, seq: traceSeq++, kind: "procedure", label: "procedure", detail: `${chat.procedure} v${liveVersion[chat.procedure] ?? 1}`, outcome: "ok", ms: int(10, 40), created_at: time });
    }
    for (const e of t.events) {
      events.push({ conversation_id: id, turn, seq: traceSeq++, ms: int(15, 140), rule_id: null, input: null, output: null, ...e, created_at: time });
    }
    messages.push({ conversation_id: id, seq: seq++, turn, role: "assistant", content: [{ type: "text", text: t.agent }] });
  });
  if (chat.handoff) {
    escalations.push({
      conversation_id: id, reason: chat.handoff.reason, summary: chat.handoff.summary, verified: chat.verified,
      rule_ids: chat.handoff.rules, customer_name: chat.verified ? customer.name : null,
      created_at: new Date(at + chat.turns.length * 45_000).toISOString(),
    });
  }
}

await insert("conversations", conversations);
await insert("messages", messages);
await insert("trace_events", events);
await insert("escalations", escalations);
console.log(`Done: ${conversations.length} chats, ${escalations.length} handoffs, ${conversations.filter((c) => c.csat).length} rated.`);
