import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { Trace } from "./trace.ts";

export type Kind = "procedure" | "tool" | "guard" | "grounding" | "escalation";
export type Outcome = "ok" | "denied" | "blocked" | "flagged" | "error";

export interface TraceEvent {
  seq: number;
  kind: Kind;
  label: string;
  detail: string;
  outcome: Outcome;
  rule_id: string | null;
  ms: number;
  input: unknown;
  output: unknown;
}

export interface Conversation {
  id: string;
  user_id: string;
  status: "active" | "escalated";
  verified_customer_id: string | null;
  verify_failures: number;
  current_procedure: string | null;
  current_version: number | null;
}

export interface Escalation {
  summary: string;
  verified: boolean;
  rule_ids: string[];
  customer_name?: string;
}

// Anthropic content blocks. Unknown block types are stored and replayed as-is.
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

export interface ToolContext {
  db: SupabaseClient;
  conv: Conversation;
  trace: Trace;
  redteam: boolean;
  escalation?: Escalation;
}
