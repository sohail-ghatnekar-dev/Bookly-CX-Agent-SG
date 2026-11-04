// One conversation's full log, turn by turn: what the customer said, every step the agent took with its input,
// output and rule, and what it replied. Opens as a drawer, or sits inline next to the test phone.
import { useEffect, useState } from "react";
import { api, type ConversationDetail, type TraceStep } from "../lib/api";
import { ago } from "../lib/format";

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

// The log beside the test phone. It follows the phone's conversation and reloads after every reply.
export function LiveLog({ id, refresh }: { id: string | null; refresh: number }) {
  const { detail, error } = useConversation(id, refresh);
  return (
    <div className="card live-log">
      <div className="row-between">
        <div>
          <div className="eyebrow">Log</div>
          <h3>{id ? <>Conversation <span className="mono">{id.slice(0, 8)}</span></> : "Every step the agent takes"}</h3>
        </div>
      </div>
      {!id && <p className="muted small">Send a message in the phone. Each turn shows up here: what the customer said, every tool call and guardrail with its input, output and rule, and the reply.</p>}
      {error && <p className="error small">{error}</p>}
      {id && !detail && !error && <p className="muted small">Loading…</p>}
      {id && detail && <LogBody detail={detail} />}
    </div>
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
