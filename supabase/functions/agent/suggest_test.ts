import { assertEquals } from "jsr:@std/assert@1";
import { suggestReplies, type SuggestionEvent, type SuggestionInput } from "./suggest.ts";

const orders: SuggestionEvent = {
  label: "list_orders",
  outcome: "ok",
  rule_id: null,
  output: {
    orders: [
      { order: "BK-1051", status: "processing", items: [{ line: "BK-1051-1", title: "Klara and the Sun" }] },
      { order: "BK-1038", status: "shipped", items: [{ line: "BK-1038-1", title: "Braiding Sweetgrass" }] },
      { order: "BK-1042", status: "delivered", items: [{ line: "BK-1042-1", title: "Piranesi" }, { line: "BK-1042-2", title: "Circe" }] },
      { order: "BK-0987", status: "delivered", items: [{ line: "BK-0987-1", title: "The Overstory" }] },
    ],
  },
};
const eligibility = (outcome: string, rule_id: string): SuggestionEvent => ({ label: "eligibility", outcome, rule_id, output: null });

function input(overrides: Partial<SuggestionInput>): SuggestionInput {
  return { reply: "Anything else?", procedure: "returns", verified: true, escalated: false, events: [orders], ...overrides };
}

Deno.test("which order: offers the titles the reply names", () => {
  const reply = "You have two open orders: Klara and the Sun and Braiding Sweetgrass. Which one?";
  assertEquals(suggestReplies(input({ reply, procedure: "order_status" })), ["Klara and the Sun", "Braiding Sweetgrass"]);
});

Deno.test("which book, none named: offer delivered titles for a return", () => {
  const reply = "Thanks, you're verified. Which book would you like to return?";
  assertEquals(suggestReplies(input({ reply })), ["Piranesi", "Circe", "The Overstory"]);
});

Deno.test("which order, none named: offer open orders for order status", () => {
  const reply = "Which order would you like me to check?";
  assertEquals(suggestReplies(input({ reply, procedure: "order_status" })), ["Klara and the Sun", "Braiding Sweetgrass"]);
});

Deno.test("question mid-reply, all titles named: a return offers the delivered ones", () => {
  const reply = "Which book would you like to return? I see Klara and the Sun, Braiding Sweetgrass, Circe, Piranesi, and The Overstory.";
  assertEquals(suggestReplies(input({ reply })), ["Piranesi", "Circe", "The Overstory"]);
});

Deno.test("one title named is not a choice", () => {
  assertEquals(suggestReplies(input({ reply: "Is it The Overstory you want to return?", events: [orders] })), []);
});

Deno.test("return reason question offers both reasons", () => {
  const reply = "I found The Overstory. Did it arrive damaged or defective, or did you change your mind?";
  assertEquals(suggestReplies(input({ reply })), ["It arrived damaged", "I changed my mind"]);
});

Deno.test("eligible and not started: confirm or decline", () => {
  const reply = "Piranesi is eligible. Shall I start the return?";
  assertEquals(suggestReplies(input({ reply, events: [orders, eligibility("ok", "RET-30")] })), ["Yes, start the return", "No, thanks"]);
});

Deno.test("past 30 days: offer the damaged route or a person", () => {
  const reply = "That’s past the 30-day window. Did it arrive damaged?";
  assertEquals(suggestReplies(input({ reply, events: [orders, eligibility("denied", "RET-30")] })), ["It arrived damaged", "Talk to a person"]);
});

Deno.test("ebook denial only offers a person", () => {
  const reply = "Ebooks can’t be returned. Can I help with anything else?";
  assertEquals(suggestReplies(input({ reply, events: [orders, eligibility("denied", "RET-DIGITAL")] })), ["Talk to a person"]);
});

Deno.test("after the return is created, no confirm buttons", () => {
  const started: SuggestionEvent = { label: "initiate_return", outcome: "ok", rule_id: "RET-30", output: null };
  assertEquals(suggestReplies(input({ reply: "Anything else?", events: [orders, eligibility("ok", "RET-30"), started] })), []);
});

Deno.test("an offer of a person gets yes or no, verified or not", () => {
  const reply = "It’s running late. Would you like me to connect you with a human teammate to look into it?";
  assertEquals(suggestReplies(input({ reply, procedure: "order_status" })), ["Yes, connect me", "No, thanks"]);
  assertEquals(suggestReplies(input({ reply: "I don’t have that information. Would you like to talk to a person?", verified: false, procedure: "policy_qa", events: [] })), ["Yes, connect me", "No, thanks"]);
});

Deno.test("mentioning a person outside the question is not an offer", () => {
  const reply = "A teammate can help with that. Is there anything else I can help with?";
  assertEquals(suggestReplies(input({ reply, verified: false, procedure: "policy_qa", events: [] })), []);
});

Deno.test("nothing before verification, after a handoff, or without a question", () => {
  const reply = "Did it arrive damaged, or did you change your mind?";
  assertEquals(suggestReplies(input({ reply, verified: false })), []);
  assertEquals(suggestReplies(input({ reply, escalated: true })), []);
  assertEquals(suggestReplies(input({ reply: "Your return has been started." })), []);
});
