// Typed calls to the console and watchtower Edge Functions.
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export interface Version {
  name: string;
  version: number;
  title: string | null;
  body: string;
  tools: string[];
  is_active: boolean;
  published_at: string | null;
  author: string | null;
  note: string;
  created_at: string;
  latest_run: string | null;
  tried_in_preview: boolean;
}

export interface Tool {
  name: string;
  description: string;
  always_on: boolean;
  input_schema?: { properties?: Record<string, { type?: string; description?: string; enum?: string[] }>; required?: string[] };
}

// A tool added from Build › Tools: a request to engineering, not callable until it's built and deployed.
export interface CustomTool {
  id: string;
  name: string;
  description: string;
  type: "coded" | "api" | "integration";
  method: string | null;
  url: string | null;
  inputs: { name: string; type: string; required: boolean; description: string }[];
  guardrails: string;
  created_by: string;
  created_at: string;
}

// The fields an AOP version is saved with. Its tools are the ones the body references with @.
export interface AopDraft {
  name: string;
  title: string;
  body: string;
  note: string;
}

export interface Scenario {
  id: string;
  procedure: string;
  expect: string; // what should happen, in plain English
  turns: string[];
  checks: string[]; // each check, in plain English
  gate: boolean;
}

export interface CheckResult {
  check: string;
  passed: boolean;
  problem?: string;
}

export interface Overview {
  versions: Version[];
  tools: Tool[];
  scenarios: Scenario[];
  latest_eval: { model: string; total: number; passed: number; resolved: number; escalated: number; ran_at: string } | null;
  metadata: { key: string; description: string }[];
  custom_tools: CustomTool[];
}

export interface SimResult {
  scenario_id: string;
  passed: boolean;
  outcome: "resolved" | "escalated" | "failed";
  failures: string[];
  checks?: CheckResult[];
  replies: string[];
  conversation_id: string | null;
  ms: number;
}

export interface AuditEvent {
  id: string;
  procedure: string;
  version: number | null;
  action: "created" | "draft_saved" | "draft_discarded" | "simulation_run" | "published" | "rolled_back" | "retired";
  title: string | null;
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
  flags: string[];
  handoff: string | null;
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
  created_at: string;
}

export interface ConversationDetail {
  conversation: { id: string; created_at: string; status: string; source: string; current_procedure: string | null; current_version: number | null; verified: boolean; csat: number | null };
  messages: { turn: number; role: string; text: string; sent: boolean }[];
  trace: TraceStep[];
}

export interface ChatTraceLine {
  seq: number;
  kind: string;
  label: string;
  detail: string;
  outcome: string;
  rule_id?: string;
  ms: number;
}

export interface Escalation {
  summary: string;
  verified: boolean;
  rule_ids: string[];
  customer_name?: string;
}

// What the agent sends back for one message: the same shape the iPhone app gets.
export interface ChatReply {
  conversation_id: string;
  turn: number;
  reply: string;
  status: string;
  citations: string[];
  suggestions: string[];
  trace: ChatTraceLine[];
  escalation?: Escalation;
}

export interface TestOrder {
  order_number: string;
  email: string;
  status: string;
  delivered_days_ago: number | null;
  items: string[];
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
  latest_eval: { model: string; total: number; passed: number; ran_at: string } | null;
  categories: (Count & { deflected: number })[];
  daily: { date: string; total: number; deflected: number; csat: number | null }[];
  csat: { rated: number; average: number | null; counts: number[] };
  watchtowers: Watchtower[];
  hourly: number[];
  messages_per_chat: number[];
  articles: Count[];
}

export interface Watchtower {
  key: string;
  name: string;
  category: string;
  rubric: string;
  count: number;
  analyzed: number;
  daily: { date: string; passed: number; flagged: number }[];
  conversations: {
    id: string;
    created_at: string;
    topic: string;
    aop: string | null;
    status: string;
    verified: boolean;
    csat: number | null;
  }[];
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
  createAop: (draft: AopDraft) => consoleCall<{ name: string; version: number }>("create_aop", { ...draft }),
  saveDraft: (draft: AopDraft) => consoleCall<{ name: string; version: number }>("save_draft", { ...draft }),
  createTool: (tool: Omit<CustomTool, "id" | "created_by" | "created_at" | "method" | "url"> & { method?: string; url?: string }) =>
    consoleCall<{ tool: CustomTool }>("create_tool", { ...tool }),
  discardDraft: (name: string, version: number) => consoleCall<{ name: string }>("discard_draft", { name, version }),
  retire: (name: string) => consoleCall<{ version: number }>("retire", { name }),
  chat: (message: string, conversationId: string | null, testing?: { name: string; version: number }) =>
    consoleCall<ChatReply>("chat", { message, conversation_id: conversationId, testing }),
  rate: (conversationId: string, rating: number) => consoleCall<{ rating: number }>("rate", { conversation_id: conversationId, rating }),
  runStart: (name: string, version: number) => consoleCall<{ run_id: string; scenarios: string[] }>("run_start", { name, version }),
  runScenario: (runId: string, scenarioId: string) => consoleCall<SimResult>("run_scenario", { run_id: runId, scenario_id: scenarioId }),
  runGet: (runId: string) => consoleCall<{ run: { id: string; created_at: string; started_by: string; version: number }; results: SimResult[] }>("run_get", { run_id: runId }),
  publish: (name: string, version: number) => consoleCall<{ previous: number | null }>("publish", { name, version }),
  rollback: (name: string, version: number) => consoleCall<{ previous: number | null }>("rollback", { name, version }),
  testCustomers: () => consoleCall<{ orders: TestOrder[] }>("test_customers"),
  auditLog: () => consoleCall<{ events: AuditEvent[] }>("audit_log"),
  conversations: (source: "live" | "test" = "live") => consoleCall<{ conversations: ConversationSummary[] }>("conversations", { source }),
  conversation: (id: string) => consoleCall<ConversationDetail>("conversation", { id }),
  watchtower: () => call<WatchtowerSummary>("watchtower", {}),
};
