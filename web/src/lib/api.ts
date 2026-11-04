// Typed calls to the console and watchtower Edge Functions.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface Version {
  name: string;
  version: number;
  body: string;
  is_active: boolean;
  published_at: string | null;
  author: string | null;
  note: string;
  created_at: string;
  latest_run: string | null;
}

export interface Tool {
  name: string;
  description: string;
}

export interface Scenario {
  id: string;
  procedure: string;
  turns: string[];
  gate: boolean;
}

export interface Overview {
  versions: Version[];
  tools: Tool[];
  scenarios: Scenario[];
}

export interface SimResult {
  scenario_id: string;
  passed: boolean;
  outcome: "resolved" | "escalated" | "failed";
  failures: string[];
  replies: string[];
  conversation_id: string | null;
  ms: number;
}

export interface AuditEvent {
  id: string;
  procedure: string;
  version: number | null;
  action: "draft_saved" | "simulation_run" | "published" | "rolled_back";
  actor: string;
  detail: string;
  created_at: string;
}

export interface ConversationSummary {
  id: string;
  created_at: string;
  status: string;
  aop: string | null;
  verified: boolean;
  turns: number;
  steps: number;
  guards: string[];
  denials: number;
}

export interface TraceStep {
  turn: number;
  seq: number;
  kind: string;
  label: string;
  detail: string;
  outcome: string;
  rule_id: string | null;
  ms: number;
  input: unknown;
  output: unknown;
}

export interface ConversationDetail {
  conversation: { id: string; created_at: string; status: string; source: string; current_procedure: string | null; current_version: number | null; verified: boolean };
  messages: { turn: number; role: string; text: string }[];
  trace: TraceStep[];
}

export interface Count {
  key: string;
  name: string;
  count: number;
}

export interface WatchtowerSummary {
  days: number;
  conversations: number;
  handled_by_agent: number;
  sent_to_employee: number;
  avg_turns: number;
  returns_created: number;
  flagged_conversations: number;
  topics: Count[];
  handoff_reasons: Count[];
  recent_handoffs: { reason: string; at: string }[];
  controls: (Count & { what: string })[];
  rules_enforced: Count[];
  recent_flags: { name: string; detail: string; at: string }[];
  latest_eval: { model: string; total: number; passed: number } | null;
}

async function call<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(fn, { body });
  if (error) {
    // The functions return { error } with a readable message; show that instead of the HTTP status.
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null);
      throw new Error(detail?.error ?? error.message);
    }
    throw error;
  }
  return data as T;
}

const consoleCall = <T>(action: string, input: Record<string, unknown> = {}) => call<T>("console", { action, ...input });

export const api = {
  overview: () => consoleCall<Overview>("overview"),
  saveDraft: (name: string, body: string, note: string) => consoleCall<{ name: string; version: number }>("save_draft", { name, body, note }),
  runStart: (name: string, version: number) => consoleCall<{ run_id: string; scenarios: string[] }>("run_start", { name, version }),
  runScenario: (runId: string, scenarioId: string) => consoleCall<SimResult>("run_scenario", { run_id: runId, scenario_id: scenarioId }),
  runGet: (runId: string) => consoleCall<{ run: { id: string; created_at: string }; results: SimResult[] }>("run_get", { run_id: runId }),
  publish: (name: string, version: number) => consoleCall<{ previous: number | null }>("publish", { name, version }),
  rollback: (name: string, version: number) => consoleCall<{ previous: number | null }>("rollback", { name, version }),
  auditLog: () => consoleCall<{ events: AuditEvent[] }>("audit_log"),
  conversations: () => consoleCall<{ conversations: ConversationSummary[] }>("conversations"),
  conversation: (id: string) => consoleCall<ConversationDetail>("conversation", { id }),
  watchtower: () => call<WatchtowerSummary>("watchtower", {}),
};
