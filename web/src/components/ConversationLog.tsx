// One conversation's full log, turn by turn: what the customer said, every step the agent took with its input,
// output and rule, and what it replied. Opens as a drawer, or sits inline next to the test phone.
import { useEffect, useState } from "react";
import { api, type ConversationDetail, type TraceStep } from "../lib/api";
import { ago, aopTitle } from "../lib/format";
import { Icon } from "./Icon";

const OUTCOME_CLASS: Record<string, string> = { ok: "ok", denied: "warn", blocked: "bad", flagged: "bad", error: "bad" };
const SOURCE_NAMES: Record<string, string> = { live: "Conversation log", simulation: "Simulation log", test: "Test chat log" };

// Loads a conversation's log, and again whenever `refresh` changes.
function useConversation(id: string | null, refresh = 0) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!id) {
      setDetail(null);
      return;
    }
    let current = true;
    api.conversation(id)
      .then((d) => current && (setDetail(d), setError("")))
      .catch((e: Error) => current && setError(e.message));
    return () => {
      current = false;
    };
  }, [id, refresh]);
  return { detail, error };
}

export function ConversationLog({ id, onClose }: { id: string; onClose: () => void }) {
  const { detail, error } = useConversation(id);
  return (
    <div className="drawer">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">{SOURCE_NAMES[detail?.conversation.source ?? "live"]}</div>
          <h2 className="mono">{id.slice(0, 8)}</h2>
        </div>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!detail && !error && <p className="muted">Loading…</p>}
      {detail && <LogBody detail={detail} />}
    </div>
  );
}

// The log beside the test phone, as an audit trail: every event in order on one timeline, each with its time and the
// payload behind it. It follows the phone's conversation and reloads after every reply.
export function LiveLog({ id, refresh }: { id: string | null; refresh: number }) {
  const { detail, error } = useConversation(id, refresh);
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="card live-log">
      <button className="audit-head" onClick={() => setCollapsed((c) => !c)} aria-expanded={!collapsed}>
        <span>Audit logs</span>
        {id && <span className="mono muted small">{id.slice(0, 8)}</span>}
        <span className="spacer" />
        <span className={`chev${collapsed ? "" : " open"}`}><Icon name="chevron" /></span>
      </button>
      {!collapsed && (
        <>
          {!id && <p className="muted small">Send a message in the phone. Every step shows up here as it happens: the AOP it picked, each tool it used and guardrail it checked, with the full payload, and what it replied.</p>}
          {error && <p className="error small">{error}</p>}
          {id && !detail && !error && <p className="muted small">Loading…</p>}
          {id && detail && <AuditTrail detail={detail} />}
        </>
      )}
    </div>
  );
}

interface AuditEntry {
  key: string;
  title: React.ReactNode;
  at?: string;
  tone?: string;
  text?: string;
  payload?: Record<string, unknown>;
}

const STAMP: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit", second: "2-digit" };

function stepTitle(t: TraceStep): React.ReactNode {
  if (t.kind === "procedure") {
    const [name, v] = t.detail.split(" ");
    return <>Selected AOP <a className="audit-ref" href={`#/build/aops/${name}`}>{aopTitle(name)} {v?.toUpperCase()}</a></>;
  }
  if (t.kind === "tool") return <>Used tool <a className="audit-ref" href="#/build/tools">{t.label}</a></>;
  if (t.kind === "guard") return <>Guardrail <span className="audit-ref">{t.label}</span></>;
  if (t.kind === "grounding") return <>Cited policy <span className="audit-ref">{t.detail}</span></>;
  if (t.kind === "escalation") return "Handed off to a Bookly employee";
  return t.label;
}

function entriesOf({ conversation: c, messages, trace }: ConversationDetail): AuditEntry[] {
  const turns = [...new Set([...messages.map((m) => m.turn), ...trace.map((t) => t.turn)])].sort((a, b) => a - b);
  const out: AuditEntry[] = [];
  for (const turn of turns) {
    messages.filter((m) => m.turn === turn && m.role === "user").forEach((m, i) =>
      out.push({ key: `u${turn}.${i}`, title: "Customer message", text: m.text }));
    messages.filter((m) => m.turn === turn && m.role === "assistant" && !m.sent).forEach((m, i) =>
      out.push({ key: `n${turn}.${i}`, title: "Agent note, not sent to the customer", text: m.text, tone: "quiet" }));
    trace.filter((t) => t.turn === turn).forEach((t) => {
      const payload: Record<string, unknown> = { detail: t.detail, outcome: t.outcome };
      if (t.rule_id) payload.rule_id = t.rule_id;
      if (t.input != null) payload.input = t.input;
      if (t.output != null) payload.output = t.output;
      payload.ms = t.ms;
      out.push({ key: `s${t.seq}`, title: stepTitle(t), at: t.created_at, tone: OUTCOME_CLASS[t.outcome], payload });
    });
    messages.filter((m) => m.turn === turn && m.role === "assistant" && m.sent).forEach((m, i) =>
      out.push({ key: `a${turn}.${i}`, title: "Sent reply", text: m.text, tone: "reply" }));
  }
  if (c.status === "escalated") out.push({ key: "status", title: "Conversation is with a Bookly employee", tone: "warn" });
  if (c.csat) out.push({ key: "csat", title: <>Customer rated the chat <span className="audit-stars">{"★".repeat(c.csat)}{"☆".repeat(5 - c.csat)}</span></>, payload: { csat: c.csat } });
  return out;
}

function AuditTrail({ detail }: { detail: ConversationDetail }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const c = detail.conversation;
  const entries = entriesOf(detail);
  const toggle = (key: string) => setOpen((o) => {
    const next = new Set(o);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });
  return (
    <>
      <div className="chips">
        <span className="chip">{c.verified ? "Verified" : "Not verified"}</span>
        <span className={`chip ${c.status === "escalated" ? "warn" : ""}`}>{c.status === "escalated" ? "Sent to an employee" : "Handled by the agent"}</span>
        <span className="chip">{detail.trace.length} {detail.trace.length === 1 ? "step" : "steps"}</span>
        <span className="spacer" />
        <button className="link small" onClick={() => setAll((a) => !a)}>{all ? "Collapse all" : "Expand all"}</button>
      </div>
      <ol className="audit">
        {entries.map((e) => {
          const expanded = all || open.has(e.key);
          const items = e.payload ? Object.keys(e.payload).length : 0;
          return (
            <li key={e.key} className={`audit-entry ${e.tone ?? ""}`}>
              <div className="audit-title">{e.title}</div>
              {e.at && <div className="audit-time">{new Date(e.at).toLocaleString("en-US", STAMP)}</div>}
              {e.text && <div className="audit-text">{e.text}</div>}
              {e.payload && (
                <button className="audit-payload mono" onClick={() => toggle(e.key)} aria-expanded={expanded}>
                  <span className="audit-brace">{"{}"}</span> "payload" : <b>{expanded ? "{" : "{…}"}</b> <i>{items} {items === 1 ? "item" : "items"}</i>
                </button>
              )}
              {e.payload && expanded && <pre className="audit-json">{JSON.stringify(e.payload, null, 2)}</pre>}
            </li>
          );
        })}
      </ol>
    </>
  );
}

function LogBody({ detail }: { detail: ConversationDetail }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [all, setAll] = useState(false);
  const { conversation: c, messages, trace } = detail;
  const turns = [...new Set([...messages.map((m) => m.turn), ...trace.map((t) => t.turn)])].sort((a, b) => a - b);

  function toggle(seq: number) {
    setOpen((o) => {
      const next = new Set(o);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  }

  return (
    <>
      <div className="chips">
        <span className="chip">{ago(c.created_at)}</span>
        <span className="chip">{c.verified ? "Verified" : "Not verified"}</span>
        <span className={`chip ${c.status === "escalated" ? "warn" : ""}`}>{c.status === "escalated" ? "Sent to an employee" : "Handled by the agent"}</span>
        {c.current_procedure && <span className="chip mono">{c.current_procedure} v{c.current_version}</span>}
        <span className="chip">{trace.length} {trace.length === 1 ? "step" : "steps"}</span>
        <label className="toggle log-toggle"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show every input and output</label>
      </div>
      <ol className="log-turns">
        {turns.map((turn) => (
          <li key={turn} className="log-turn">
            <div className="log-turn-n mono">Turn {turn}</div>
            {messages.filter((m) => m.turn === turn && m.role === "user").map((m, i) => (
              <div key={`u${i}`} className="log-said"><span className="log-who">Customer</span>{m.text}</div>
            ))}
            {messages.filter((m) => m.turn === turn && m.role === "assistant" && !m.sent).map((m, i) => (
              <div key={`n${i}`} className="log-said note"><span className="log-who">Agent, not sent to the customer</span>{m.text}</div>
            ))}
            <ol className="steps">
              {trace.filter((t) => t.turn === turn).map((t) => (
                <Step key={t.seq} step={t} open={all || open.has(t.seq)} onToggle={() => toggle(t.seq)} />
              ))}
            </ol>
            {messages.filter((m) => m.turn === turn && m.role === "assistant" && m.sent).map((m, i) => (
              <div key={`a${i}`} className="log-said agent"><span className="log-who">Agent reply</span>{m.text}</div>
            ))}
          </li>
        ))}
      </ol>
    </>
  );
}

function Step({ step: t, open, onToggle }: { step: TraceStep; open: boolean; onToggle: () => void }) {
  return (
    <li className={`step ${t.kind === "guard" ? "guard" : ""}`}>
      <button className="step-row" onClick={onToggle} aria-expanded={open}>
        <span className="mono step-kind">{t.kind === t.label ? "" : t.kind}</span>
        <span className="mono step-label">{t.label}</span>
        <span className="step-detail">{t.detail}</span>
        {t.rule_id && <span className="chip mono">{t.rule_id}</span>}
        <span className={`pill ${OUTCOME_CLASS[t.outcome] ?? ""}`}>{t.outcome}</span>
        <span className="mono muted step-ms">{t.ms} ms</span>
      </button>
      {open && (
        <div className="io">
          <div>
            <div className="eyebrow">Input</div>
            <pre>{JSON.stringify(t.input, null, 2) ?? "—"}</pre>
          </div>
          <div>
            <div className="eyebrow">Output</div>
            <pre>{JSON.stringify(t.output, null, 2) ?? "—"}</pre>
          </div>
        </div>
      )}
    </li>
  );
}
