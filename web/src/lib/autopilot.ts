// Autopilot: suggestions drawn from the last 30 days of chats. Each one targets the topic where the most chats still
// reach a person, says what to change, and for a new AOP brings a draft that's most of the way there.
import type { WatchtowerSummary } from "./api";

export interface Suggestion {
  key: string; // used in the link: #/build/aops/new?from=<key>
  category: string; // the Insights category it comes from
  title: string;
  target: string; // the AOP to open, or "new"
  watchtower?: string; // the watchtower that shows the conversations behind it
  draft?: { title: string; goal: string; logic: string; note: string; finish: string };
}

export const SUGGESTIONS: Suggestion[] = [
  {
    key: "late_delivery",
    category: "Late delivery",
    title: "New AOP: late orders, answered with a carrier update and a scheduled follow-up",
    target: "new",
    watchtower: "late_order",
    draft: {
      title: "Late orders",
      goal: "Use this AOP when a customer's order is past its estimated delivery date, or they say it's late.",
      logic: `1. Verify identity first with @verify_customer: the order number and the email on that order. Same rules as #order_status.
2. Call @get_order_status. If the order isn't late, switch to #order_status.
3. Apologize once, using {{ customer.first_name }}, then give the carrier, the tracking number and the date it was expected, in plain words.
4. Most late parcels arrive within 2 business days of a missed estimate. Say so, and offer to email them an update with @schedule_follow_up so they don't have to check back.
5. `,
      note: "Suggested by Autopilot: late-delivery chats",
      finish: "Finish step 5: if they say yes, call @schedule_follow_up, so no one has to step in.",
    },
  },
  {
    key: "damaged",
    category: "Damaged or defective item",
    title: "New AOP: damaged items, with the 60-day window up front",
    target: "new",
    draft: {
      title: "Damaged items",
      goal: "Use this AOP when a customer's book arrived damaged or defective.",
      logic: `1. Verify identity first with @verify_customer: the order number and the email on that order.
2. Call @get_order_status to see the items. If they already said which book, don't ask again.
3. Call @check_return_eligibility with the reason damaged_defective. Its answer is final.
4. If eligible, call @initiate_return and give the RMA number.
5. `,
      note: "Suggested by Autopilot: damaged-item chats",
      finish: "Finish step 5: what happens when it isn't eligible?",
    },
  },
  { key: "change_of_mind", category: "Change-of-mind return", title: "Returns: explain the 30-day window before checking eligibility", target: "returns" },
  { key: "ebook", category: "Ebook return", title: "Returns: explain ebook rules and offer a format exchange", target: "returns" },
  { key: "account", category: "Account and password", title: "Policy questions: walk through the password reset step by step", target: "policy_qa" },
  { key: "other", category: "Other", title: "New AOP: address changes, gift cards and pre-orders", target: "new" },
];

// What the data says about one suggestion: volume, how many reached a person, and the weekly gain if half are contained.
export function evidence(s: WatchtowerSummary, suggestion: Suggestion) {
  const c = s.categories.find((x) => x.name === suggestion.category);
  if (!c) return null;
  const handed = c.count - c.deflected;
  const perWeek = (n: number) => Math.round((n / s.days) * 7);
  const lowest = [...s.categories].filter((x) => x.count >= 20)
    .sort((a, b) => a.deflected / a.count - b.deflected / b.count)[0]?.name === c.name;
  return {
    count: c.count,
    handed,
    deflection: Math.round((c.deflected / c.count) * 100),
    perWeek: perWeek(c.count),
    gain: Math.max(1, Math.round(perWeek(handed) * 0.5)),
    lowest,
    watchtower: s.watchtowers.find((w) => w.key === suggestion.watchtower),
    days: s.days,
  };
}

// The top suggestions: the topics where the most chats still reach a person.
export function topSuggestions(s: WatchtowerSummary, n = 3): Suggestion[] {
  return SUGGESTIONS
    .map((sug) => ({ sug, e: evidence(s, sug) }))
    .filter((x) => x.e && x.e.handed > 0)
    .sort((a, b) => b.e!.handed - a.e!.handed)
    .slice(0, n)
    .map((x) => x.sug);
}

export function linkFor(s: Suggestion): string {
  return s.target === "new" ? (s.draft ? `#/build/aops/new?from=${s.key}` : "#/build/aops/new") : `#/build/aops/${s.target}`;
}
