// Watchtower: how the agent is doing, every control and how often it fired, and the log behind each conversation.
import { useEffect, useState } from "react";
import { ConversationLog } from "../components/ConversationLog";
import { api, type ConversationSummary, type WatchtowerSummary } from "../lib/api";
import { ago, percent } from "../lib/format";

export function WatchtowerPage() {
  const [summary, setSummary] = useState<WatchtowerSummary | null>(null);
  const [rows, setRows] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState("");
  const [logId, setLogId] = useState<string | null>(null);

  async function load() {
    try {
      const [s, c] = await Promise.all([api.watchtower(), api.conversations()]);
      setSummary(s);
      setRows(c.conversations);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => void load(), []);

  if (error) return <div className="empty error">{error}</div>;
  if (!summary) return <div className="empty muted">Loading Watchtower…</div>;

  const s = summary;
  return (
    <div className="watchtower">
      <div className="row-between">
        <div>
          <div className="eyebrow">Watchtower · last {s.days} days · live conversations only</div>
          <h1>Every conversation, every control</h1>
        </div>
        <button className="secondary" onClick={load}>Refresh</button>
      </div>

      <div className="stats">
        <Stat value={percent(s.handled_by_agent, s.conversations)} label="Handled by the agent" />
        <Stat value={percent(s.sent_to_employee, s.conversations)} label="Sent to an employee" />
        <Stat value={String(s.conversations)} label="Conversations" />
        <Stat value={String(s.returns_created)} label="Returns created" />
        <Stat value={String(s.flagged_conversations)} label="Flagged for review" warn={s.flagged_conversations > 0} />
        <Stat value={s.latest_eval ? `${s.latest_eval.passed}/${s.latest_eval.total}` : "–"} label="Latest eval run" />
      </div>

      <div className="grid-2">
        <div className="card">
          <h3>Guardrails that fired</h3>
          <p className="muted small">Every control the agent has, listed even at zero. Each one is code, not a prompt.</p>
          {s.controls.map((c) => (
            <div key={c.key} className="control">
              <div>
                <div>{c.name}</div>
                <div className="muted small">{c.what}</div>
              </div>
              <span className={`count${c.count ? " hot" : ""}`}>{c.count}</span>
            </div>
          ))}
          {s.rules_enforced.length > 0 && (
            <>
              <div className="eyebrow spaced">Return rules enforced</div>
              {s.rules_enforced.map((r) => (
                <div key={r.key} className="control">
                  <span className="mono">{r.key}</span>
                  <span className="count">{r.count} denied</span>
                </div>
              ))}
            </>
          )}
        </div>
        <div className="col">
          <div className="card">
            <h3>What readers ask</h3>
            {s.topics.map((t) => <Bar key={t.key} name={t.name} count={t.count} total={s.conversations} />)}
          </div>
          <div className="card">
            <h3>When an employee steps in</h3>
            {s.handoff_reasons.map((h) => <Bar key={h.key} name={h.name} count={h.count} total={Math.max(s.sent_to_employee, 1)} />)}
            {s.recent_handoffs.map((h, i) => (
              <div key={i} className="control"><span className="small">{h.reason}</span><span className="muted small">{ago(h.at)}</span></div>
            ))}
          </div>
          <div className="card">
            <h3>Flagged for review</h3>
            {s.recent_flags.length === 0 ? (
              <p className="muted small">Nothing flagged: no made-up citations, unbacked claims, refusals or step limits.</p>
            ) : (
              s.recent_flags.map((f, i) => (
                <div key={i} className="control"><span>{f.name}</span><span className="muted small">{ago(f.at)}</span></div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Conversation log</h3>
        <p className="muted small">Open any conversation to see what was said and every step the agent took, with its input, output and the rule that decided it.</p>
        <table className="log">
          <thead>
            <tr><th>When</th><th>Conversation</th><th>AOP</th><th>Verified</th><th>Outcome</th><th>Steps</th><th>Guardrails</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => setLogId(r.id)}>
                <td className="muted">{ago(r.created_at)}</td>
                <td className="mono">{r.id.slice(0, 8)}</td>
                <td className="mono">{r.aop ?? "–"}</td>
                <td>{r.verified ? "Yes" : "No"}</td>
                <td>{r.status === "escalated" ? <span className="pill warn">Employee</span> : <span className="pill ok">Agent</span>}</td>
                <td className="mono">{r.steps}</td>
                <td>{r.guards.length ? r.guards.map((g) => <span key={g} className="pill bad">{g}</span>) : <span className="muted">–</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">No live conversations yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {logId && <ConversationLog id={logId} onClose={() => setLogId(null)} />}
    </div>
  );
}

function Stat({ value, label, warn }: { value: string; label: string; warn?: boolean }) {
  return (
    <div className="stat">
      <div className={`stat-value${warn ? " hot" : ""}`}>{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}

function Bar({ name, count, total }: { name: string; count: number; total: number }) {
  return (
    <div className="bar">
      <div className="bar-top"><span>{name}</span><span className="mono muted">{count}</span></div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(100, (count / Math.max(total, 1)) * 100)}%` }} /></div>
    </div>
  );
}
