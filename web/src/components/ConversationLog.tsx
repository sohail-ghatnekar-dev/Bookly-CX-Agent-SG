// One conversation's full log: the transcript, then every step the agent took with its input, output and rule.
import { useEffect, useState } from "react";
import { api, type ConversationDetail } from "../lib/api";
import { ago } from "../lib/format";

const OUTCOME_CLASS: Record<string, string> = { ok: "ok", denied: "warn", blocked: "bad", flagged: "bad", error: "bad" };

export function ConversationLog({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    setDetail(null);
    api.conversation(id).then(setDetail).catch((e: Error) => setError(e.message));
  }, [id]);

  return (
    <div className="drawer">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">{detail?.conversation.source === "simulation" ? "Simulation log" : "Conversation log"}</div>
          <h2 className="mono">{id.slice(0, 8)}</h2>
        </div>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!detail && !error && <p className="muted">Loading…</p>}
      {detail && (
        <>
          <div className="chips">
            <span className="chip">{ago(detail.conversation.created_at)}</span>
            <span className="chip">{detail.conversation.verified ? "Verified" : "Not verified"}</span>
            <span className={`chip ${detail.conversation.status === "escalated" ? "warn" : ""}`}>{detail.conversation.status === "escalated" ? "Sent to an employee" : "Handled by the agent"}</span>
            {detail.conversation.current_procedure && <span className="chip">{detail.conversation.current_procedure} v{detail.conversation.current_version}</span>}
          </div>
          <h3>Transcript</h3>
          <div className="transcript">
            {detail.messages.map((m, i) => (
              <div key={i} className={`bubble ${m.role}`}>{m.text}</div>
            ))}
          </div>
          <h3>Every step</h3>
          <ol className="steps">
            {detail.trace.map((t) => (
              <li key={t.seq} className={`step ${t.kind === "guard" ? "guard" : ""}`}>
                <button className="step-row" onClick={() => setOpen(open === t.seq ? null : t.seq)}>
                  <span className="mono step-turn">T{t.turn}</span>
                  <span className="mono step-label">{t.label}</span>
                  <span className="step-detail">{t.detail}</span>
                  {t.rule_id && <span className="chip mono">{t.rule_id}</span>}
                  <span className={`pill ${OUTCOME_CLASS[t.outcome] ?? ""}`}>{t.outcome}</span>
                  <span className="mono muted step-ms">{t.ms} ms</span>
                </button>
                {open === t.seq && (
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
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
