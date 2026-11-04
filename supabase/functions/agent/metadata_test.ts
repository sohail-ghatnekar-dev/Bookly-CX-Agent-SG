// Unit tests for {{ metadata }}: known keys are filled in, unknown or not-yet-known ones read "unknown".
import { assertEquals } from "jsr:@std/assert@1";
import { fill } from "./metadata.ts";

Deno.test("fills known keys, with or without spaces inside the braces", () => {
  const body = "If {{ customer.is_new }} is yes, welcome {{customer.first_name}} on {{ channel }}.";
  assertEquals(fill(body, { "customer.is_new": "yes", "customer.first_name": "Maya", channel: "chat" }), "If yes is yes, welcome Maya on chat.");
});

Deno.test("a key with no value yet reads unknown", () => {
  assertEquals(fill("Orders: {{ customer.order_count }}", { channel: "chat" }), "Orders: unknown");
});
