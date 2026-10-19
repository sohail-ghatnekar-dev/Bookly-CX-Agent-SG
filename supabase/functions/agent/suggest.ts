// Tap-to-answer suggestions for the app. Pure: derived from conversation state, never from
// the model, and offered only when the reply asks something. Typing always still works.

export interface SuggestionEvent {
  label: string;
  outcome: string;
  rule_id: string | null;
  output: unknown;
}

export interface SuggestionInput {
  reply: string;
  procedure: string | null;
  verified: boolean;
  escalated: boolean;
  events: SuggestionEvent[]; // this conversation's trace, oldest first
}

const MAX = 3;
export const DAMAGED = "It arrived damaged";
export const CHANGED_MIND = "I changed my mind";
export const CONFIRM = "Yes, start the return";
export const DECLINE = "No, thanks";
export const HUMAN = "Talk to a person";
export const ACCEPT_PERSON = "Yes, connect me";

export function suggestReplies(s: SuggestionInput): string[] {
  // A handed-off case takes no more input, and buttons only answer a question.
  if (s.escalated || !s.reply.includes("?")) return [];
  const options = s.verified ? forVerified(s) : [];
  if (options.length) return options;
  return offersPerson(s.reply) ? [ACCEPT_PERSON, DECLINE] : [];
}

// "Would you like me to connect you with a teammate?" and the like.
function offersPerson(reply: string): boolean {
  return reply.split(/(?<=[.?!])\s+/).some((sentence) =>
    sentence.trim().endsWith("?") &&
    /\b(person|teammate|human|someone on our team)\b/i.test(sentence) &&
    /\b(would you like|shall i|should i|do you want|want me to)\b/i.test(sentence)
  );
}

// Email and ZIP are typed, so everything else waits until the customer is verified.
function forVerified(s: SuggestionInput): string[] {
  const check = s.events.findLast((e) => e.label === "eligibility");
  const started = check &&
    s.events.slice(s.events.indexOf(check)).some((e) => e.label === "initiate_return" && e.outcome === "ok");
  if (check && !started) {
    if (check.outcome === "ok") return [CONFIRM, DECLINE];
    if (check.outcome === "denied") return check.rule_id === "RET-30" ? [DAMAGED, HUMAN] : [HUMAN];
  }

  if (s.procedure === "returns" && /damaged|defective/i.test(s.reply) && /chang\w* (your|their) mind|change of mind/i.test(s.reply)) {
    return [DAMAGED, CHANGED_MIND];
  }

  // "Which one?": prefer titles that fit the request (delivered items for a return, open
  // orders for order status), narrowed to the ones the reply names when it names any.
  const reply = s.reply.toLowerCase();
  const fits = orderTitles(s.events, s.procedure === "returns" ? ["delivered"] : ["shipped", "processing"]);
  const named = orderTitles(s.events).filter((title) => reply.includes(title.toLowerCase()));
  const namedFits = named.filter((title) => fits.includes(title));
  for (const options of [namedFits, named, /\bwhich\b/i.test(s.reply) && named.length === 0 ? fits : []]) {
    if (options.length >= 2) return options.slice(0, MAX);
  }
  return [];
}

type ListedOrder = { status?: string; items?: { title?: string }[] };

function orderTitles(events: SuggestionEvent[], statuses?: string[]): string[] {
  const lookup = events.findLast((e) => e.label === "list_orders" && e.outcome === "ok");
  const orders = (lookup?.output as { orders?: ListedOrder[] } | undefined)?.orders ?? [];
  const titles = orders
    .filter((o) => !statuses || statuses.includes(o.status ?? ""))
    .flatMap((o) => o.items ?? [])
    .map((i) => i.title)
    .filter((t): t is string => !!t);
  return [...new Set(titles)];
}
