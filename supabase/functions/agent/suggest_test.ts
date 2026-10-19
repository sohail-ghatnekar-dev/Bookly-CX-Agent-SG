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

Deno.test("past 30 days: offer the damaged route or an employee", () => {
  const reply = "That’s past the 30-day window. Did it arrive damaged?";
  assertEquals(suggestReplies(input({ reply, events: [orders, eligibility("denied", "RET-30")] })), ["It arrived damaged", "Send to an employee"]);
});

Deno.test("ebook denial only offers an employee", () => {
  const reply = "Ebooks can’t be returned. Can I help with anything else?";
  assertEquals(suggestReplies(input({ reply, events: [orders, eligibility("denied", "RET-DIGITAL")] })), ["Send to an employee"]);
});

Deno.test("after the return is created, no confirm buttons", () => {
  const started: SuggestionEvent = { label: "initiate_return", outcome: "ok", rule_id: "RET-30", output: null };
  assertEquals(suggestReplies(input({ reply: "Anything else?", events: [orders, eligibility("ok", "RET-30"), started] })), []);
});

Deno.test("an offer to send it to an employee gets yes or no, verified or not", () => {
  const reply = "It’s running late. Should I send this to a Bookly employee to look into it?";
  assertEquals(suggestReplies(input({ reply, procedure: "order_status" })), ["Yes, send it to an employee", "No, thanks"]);
  assertEquals(suggestReplies(input({ reply: "I don’t have that information. Would you like me to send this to a Bookly employee?", verified: false, procedure: "policy_qa", events: [] })), ["Yes, send it to an employee", "No, thanks"]);
});

Deno.test("mentioning an employee outside the question is not an offer", () => {
  const reply = "A Bookly employee can help with that. Is there anything else I can help with?";
  assertEquals(suggestReplies(input({ reply, verified: false, procedure: "policy_qa", events: [] })), []);
});

Deno.test("nothing before verification, after a handoff, or without a question", () => {
  const reply = "Did it arrive damaged, or did you change your mind?";
  assertEquals(suggestReplies(input({ reply, verified: false })), []);
  assertEquals(suggestReplies(input({ reply, escalated: true })), []);
  assertEquals(suggestReplies(input({ reply: "Your return has been started." })), []);
});
