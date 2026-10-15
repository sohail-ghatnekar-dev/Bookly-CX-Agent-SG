// Anthropic Messages API over plain fetch. No SDK.
import type { ContentBlock, Message } from "./types.ts";

const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 600;

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ApiResponse {
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "refusal" | string;
}

export class AnthropicError extends Error {
  constructor(readonly status: number, body: string) {
    super(`Anthropic API ${status}: ${body}`);
  }
}

export function modelId(): string {
  return Deno.env.get("ANTHROPIC_MODEL") || "claude-haiku-5-5";
}

// Thinking stays off: the system prompt changes between turns, and replayed thinking
// blocks are rejected once the prefix changes. Sonnet 5.5 spells "off" as between_tools.
// Temperature is omitted because current models reject non-default sampling values.
function thinkingOff(model: string) {
  return model.startsWith("claude-sonnet-5-5") ? { type: "between_tools" } : { type: "disabled" };
}

export async function createMessage(
  system: string,
  messages: Message[],
  tools: Tool[],
): Promise<ApiResponse> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("ANTHROPIC_API_KEY is not set");
  const model = modelId();
  const body = JSON.stringify({
    model,
    max_tokens: MAX_TOKENS,
    system,
    messages,
    tools,
    thinking: thinkingOff(model),
  });

  for (let attempt = 0;; attempt++) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body,
    });
    if (res.ok) return await res.json();
    const text = (await res.text()).slice(0, 300);
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 2) throw new AnthropicError(res.status, text);
    await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
}
