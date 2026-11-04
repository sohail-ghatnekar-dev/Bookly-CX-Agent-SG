// Analyze › Watchtowers: the lower-level view. Each watchtower checks every live conversation against a rubric for one
// thing going wrong, like a customer who didn't get their return, and lists the ones it caught, down to every step.
import { useEffect, useState } from "react";
import { ConversationLog } from "../components/ConversationLog";
import { api, type WatchtowerSummary } from "../lib/api";
import { ago } from "../lib/format";

export function WatchtowersPage() {
  const [s, setS] = useState<WatchtowerSummary | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [logId, setLogId] = useState<string | null>(null);

  useEffect(() => {
    api.watchtower().then(setS).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="empty error">{error}</div>;
  if (!s) return <div className="empty muted">Loading Watchtowers…</div>;

  const tower = s.watchtowers.find((w) => w.key === selected) ?? s.watchtowers[0];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Watchtowers</h1>
        <span className="sub">Every one of {s.conversations.toLocaleString()} live chats checked, not a sample · last {s.days} days</span>
      </div>
      <div className="towers">
        {s.watchtowers.map((w) => (
          <button key={w.key} className={`tower${w.key === tower.key ? " active" : ""}`} onClick={() => setSelected(w.key)} aria-pressed={w.key === tower.key}>
            <span className="tag" style={{ alignSelf: "flex-start" }}>{w.category}</span>
            <div className="tower-top">
              <b>{w.name}</b>
              <span className={`tower-count${w.count ? "" : " zero"}`}>{w.count}</span>
            </div>
            <span className="muted small">{w.rubric}</span>
          </button>
        ))}
      </div>

      <div className="card table-card">
        <div className="card-head">
          <h2>{tower.name}</h2>
          <span className="muted small">
            {tower.count} conversation{tower.count === 1 ? "" : "s"}{tower.count > tower.conversations.length ? `, newest ${tower.conversations.length} shown` : ""}. Open one to see why the agent did what it did.
          </span>
        </div>
        <table className="log">
          <thead><tr><th>When</th><th>Conversation</th><th>Topic</th><th>AOP</th><th>Verified</th><th>Outcome</th><th>CSAT</th></tr></thead>
          <tbody>
            {tower.conversations.map((c) => (
              <tr key={c.id} className="clickable" onClick={() => setLogId(c.id)}>
                <td className="muted">{ago(c.created_at)}</td>
                <td className="mono">{c.id.slice(0, 8)}</td>
                <td>{c.topic}</td>
                <td className="mono">{c.aop ?? "–"}</td>
                <td>{c.verified ? "Yes" : "No"}</td>
                <td>{c.status === "escalated" ? <span className="pill warn">Employee</span> : <span className="pill ok">Agent</span>}</td>
                <td className="mono">{c.csat ? `${c.csat}/5` : "–"}</td>
              </tr>
            ))}
            {tower.conversations.length === 0 && <tr><td colSpan={7} className="muted">Nothing caught in the last {s.days} days.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Guardrails in code</h2>
        <p className="muted small">The checks built into the agent's tools, and how often each one stepped in. Listed even at zero.</p>
        <div className="guard-grid">
          {s.controls.map((c) => (
            <div key={c.key} className="guard-row">
              <div><div>{c.name}</div><div className="muted small">{c.what}</div></div>
              <span className={`mono${c.count ? "" : " muted"}`}>{c.count}</span>
            </div>
          ))}
        </div>
      </div>
      {logId && <ConversationLog id={logId} onClose={() => setLogId(null)} />}
    </div>
  );
}
