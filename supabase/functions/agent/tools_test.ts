// Unit tests for per-AOP tools: the model sees only the always-on tools plus the active AOP's, and an AOP is refused
// any tool outside its list even if the model asks for one.
import { assertEquals } from "jsr:@std/assert@1";
import { ALWAYS_ON, AOP_TOOLS, executeTool, toolsFor } from "./tools.ts";
import { Trace } from "./trace.ts";
import type { ToolContext } from "./types.ts";

Deno.test("routing and handoff are always on; the rest belong to AOPs", () => {
  assertEquals(ALWAYS_ON, ["select_procedure", "escalate_to_human"]);
  assertEquals(AOP_TOOLS.includes("initiate_return"), true);
  assertEquals(AOP_TOOLS.includes("schedule_follow_up"), true);
  assertEquals(AOP_TOOLS.some((t) => ALWAYS_ON.includes(t)), false);
});

Deno.test("the model sees only the allowed tools", () => {
  const names = toolsFor(["policy_qa"], [...ALWAYS_ON, "get_policy"]).map((t) => t.name);
  assertEquals(names, ["select_procedure", "get_policy", "escalate_to_human"]);
});

Deno.test("select_procedure lists exactly the AOPs on offer", () => {
  const select = toolsFor(["order_status", "damaged_items"], ALWAYS_ON).find((t) => t.name === "select_procedure")!;
  const schema = select.input_schema as { properties: { name: { enum: string[] } } };
  assertEquals(schema.properties.name.enum, ["order_status", "damaged_items"]);
});

Deno.test("a tool outside the active AOP is refused before it runs", async () => {
  const ctx = { trace: new Trace(1), allowed: [...ALWAYS_ON, "get_policy"] } as unknown as ToolContext;
  const result = await executeTool(ctx, { id: "t1", name: "initiate_return", input: {} });
  assertEquals(result.type === "tool_result" && result.is_error, true);
  assertEquals(ctx.trace.events.map((e) => [e.label, e.outcome]), [["tool_not_allowed", "blocked"]]);
});
