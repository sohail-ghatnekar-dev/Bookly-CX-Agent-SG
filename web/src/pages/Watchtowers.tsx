// Analyze › Watchtowers: the lower-level view. Each watchtower checks every live conversation in its scope against a
// rubric for one thing going wrong, like a customer who didn't get their return, and lists the ones it flagged.
import { useEffect, useState } from "react";
import { StackedBars } from "../components/Charts";
import { ConversationLog } from "../components/ConversationLog";
import { Icon } from "../components/Icon";
import { Info } from "../components/Info";
import { api, type WatchtowerSummary } from "../lib/api";
import { ago } from "../lib/format";

const longDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function WatchtowersPage({ initial }: { initial?: string }) {
  const [s, setS] = useState<WatchtowerSummary | null>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<string | null>(initial ?? null);
  const [logId, setLogId] = useState<string | null>(null);
  const [loadedAt] = useState(() => new Date());

  useEffect(() => {
    api.watchtower().then(setS).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="empty error">{error}</div>;
  if (!s) return <div className="empty muted">Loading Watchtowers…</div>;

  const tower = s.watchtowers.find((w) => w.key === selected) ?? s.watchtowers.find((w) => w.count > 0) ?? s.watchtowers[0];
  const from = s.daily[0]?.date;
  const to = s.daily.at(-1)?.date;
  const rate = tower.analyzed ? (tower.count / tower.analyzed) * 100 : 0;
  const lastRun = loadedAt.toLocaleString("en-US", { timeZone: "America/Los_Angeles", dateStyle: "short", timeStyle: "medium" });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Watchtowers</h1>
        <Info text="Each watchtower checks every live conversation in its scope against a rubric, not a sample, and flags the ones that fail it." />
        {from && to && (
          <span className="date-pill"><Icon name="calendar" size={14} />{longDate(`${from}T12:00:00Z`)} – {longDate(`${to}T12:00:00Z`)}</span>
        )}
        <span className="spacer" />
        <button className="secondary" disabled title="Creating watchtowers isn't part of this demo"><Icon name="plus" size={14} />Create watchtower<Icon name="down" size={14} /></button>
      </div>

      <div className="card wt-card">
        <div className="wt-head">
          <div>
            <div className="row">
              <h2 style={{ margin: 0 }}>{tower.name}</h2>
              <Info text={tower.rubric} />
            </div>
            <div className="muted">Recurring · {tower.category}</div>
          </div>
          <span className="spacer" />
          <select className="select" value={tower.key} onChange={(e) => setSelected(e.target.value)} aria-label="Watchtower">
            {s.watchtowers.map((w) => <option key={w.key} value={w.key}>{w.name} ({w.count})</option>)}
          </select>
          <button className="ghost" disabled aria-label="More">⋯</button>
        </div>
        <span className="rubric-tag">Rubric</span>
        <p className="muted small" style={{ margin: "8px 0 14px", maxWidth: 760 }}>Flag a conversation when: {tower.rubric}</p>
        <div className="wt-tiles">
          <div className="wt-tile"><span className="muted small">Conversations analyzed</span><b>{tower.analyzed.toLocaleString()}</b></div>
          <div className="wt-tile"><span className="muted small">Flagged</span><b>{tower.count.toLocaleString()}</b></div>
          <div className="wt-tile"><span className="muted small">Flagged rate</span><b>{rate.toFixed(2)}%</b></div>
        </div>
        <p className="muted small" style={{ margin: "12px 0 6px" }}>Last run: {lastRun} PT</p>
        <StackedBars days={tower.daily} />
      </div>

      <div className="card table-card">
        <div className="card-head">
          <h2>Flagged conversations</h2>
          <span className="muted small">
            {tower.count} flagged{tower.count > tower.conversations.length ? `, newest ${tower.conversations.length} shown` : ""}. Open one to see why the agent did what it did.
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
            {tower.conversations.length === 0 && <tr><td colSpan={7} className="muted">Nothing flagged in the last {s.days} days.</td></tr>}
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
