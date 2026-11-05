// Autopilot: runs on a schedule over real conversations, finds trends, drafts the change, and waits for a person to
// review it before anything goes live. Needs review comes from the live data; Accepted, Closed and Runs are a sketch.
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { Info } from "../components/Info";
import { api, type WatchtowerSummary } from "../lib/api";
import { evidence, linkFor, topSuggestions } from "../lib/autopilot";
import { go } from "../lib/router";

type Tab = "review" | "accepted" | "closed" | "runs";

// What earlier runs suggested and the team accepted: the AOP history behind the live versions.
const ACCEPTED = [
  { title: "Returns: look up the order instead of asking the customer to describe it", result: "Published as Returns v4", when: "Oct 30" },
  { title: "Returns: hand off in the same reply when a customer pushes back on a denial", result: "Published as Returns v3", when: "Oct 27" },
  { title: "Policy questions: cite the policy document behind every answer", result: "Published as Policy questions v1", when: "Oct 22" },
];

const at = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).replace(",", " at");

export function AutopilotPage() {
  const [s, setS] = useState<WatchtowerSummary | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("review");
  const [scheduled, setScheduled] = useState(true);
  const [running, setRunning] = useState(false);
  const [extraRuns, setExtraRuns] = useState<Date[]>([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api.watchtower().then(setS).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="empty error">{error}</div>;
  if (!s) return <div className="empty muted">Loading Autopilot…</div>;

  // Scheduled runs: every morning at 6:02 AM, the last seven days.
  const today = new Date();
  const scheduledRuns = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    d.setHours(6, 2, 0, 0);
    return d;
  }).filter((d) => d <= today);
  const lastScheduled = scheduledRuns[0] ?? today;
  const suggestions = topSuggestions(s, 3);
  const runs = [...extraRuns, ...scheduledRuns];

  function runNow() {
    setRunning(true);
    setNotice("");
    setTimeout(() => {
      setRunning(false);
      setExtraRuns((r) => [new Date(), ...r]);
      setNotice(`Run finished: ${s!.conversations.toLocaleString()} conversations analyzed, no new trends since this morning's run.`);
    }, 2500);
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Autopilot</h1>
        <Info text="Autopilot runs on a schedule over your real conversations, finds trends, drafts the change to the AOP, and waits for a person to review it. Nothing goes live without an approval." />
        <span className="spacer" />
        <label className="row small" style={{ gap: 10 }}>
          <button className={`toggle-switch${scheduled ? " on" : ""}`} role="switch" aria-checked={scheduled} onClick={() => setScheduled((v) => !v)} aria-label="Scheduled runs" />
          <span className="muted">{scheduled ? "Scheduled daily at 6:00 AM" : "Scheduled runs paused"}</span>
        </label>
        <button className="secondary" disabled={running} onClick={runNow}><Icon name="play" size={13} />{running ? "Running…" : "Run now"}</button>
        <button className="ghost" disabled aria-label="Settings"><Icon name="gear" /></button>
      </div>
      {notice && <div className="notice">{notice}</div>}

      <div className="tabs" role="tablist">
        {([["review", `Needs review`, suggestions.length], ["accepted", "Accepted", ACCEPTED.length], ["closed", "Closed", 0], ["runs", "Runs", null]] as const).map(([id, label, n]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
            {label}{n !== null && <span className="tab-count">{n}</span>}
          </button>
        ))}
      </div>

      {tab === "review" && (
        <div className="ap-grid">
          {suggestions.map((sug) => {
            const e = evidence(s, sug)!;
            const high = e.gain >= 7;
            return (
              <button key={sug.key} className="ap-card" onClick={() => go(linkFor(sug))}>
                <div className="row-between">
                  <span className={`priority ${high ? "high" : "medium"}`}><Icon name={high ? "high" : "medium"} size={13} />{high ? "High" : "Medium"}</span>
                  <span className="pill ok">Open</span>
                </div>
                <h3>{sug.title}</h3>
                <div className="row"><span className="tag"><Icon name="autopilot" size={12} />Optimization</span><span className="tag">AOP</span></div>
                <span className="muted small">{at(lastScheduled)}</span>
                <div className="ap-foot">
                  <span className="row"><Icon name="conversations" size={14} />{e.perWeek} convos/wk</span>
                  <span className="gain">↗ +{e.gain} contained conversations per week</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {tab === "accepted" && (
        <div className="ap-grid">
          {ACCEPTED.map((a) => (
            <div key={a.title} className="ap-card static">
              <div className="row-between"><span className="priority medium"><Icon name="medium" size={13} />Medium</span><span className="pill">Accepted</span></div>
              <h3>{a.title}</h3>
              <div className="row"><span className="tag"><Icon name="autopilot" size={12} />Optimization</span><span className="tag">AOP</span></div>
              <span className="muted small">{a.when} · reviewed by Bookly CX</span>
              <div className="ap-foot"><span>{a.result}</span></div>
            </div>
          ))}
        </div>
      )}

      {tab === "closed" && <div className="card muted">Nothing closed. Suggestions you decline land here, with the reason.</div>}

      {tab === "runs" && (
        <div className="card table-card">
          <table className="log">
            <thead><tr><th>Run</th><th>Trigger</th><th>Conversations analyzed</th><th>Suggestions</th><th>Status</th></tr></thead>
            <tbody>
              {runs.map((d, i) => (
                <tr key={d.toISOString()} className="static">
                  <td>{at(d)}</td>
                  <td className="muted">{i < extraRuns.length ? "Run now" : "Scheduled"}</td>
                  <td className="mono">{s.conversations.toLocaleString()}</td>
                  <td className="mono">{i < extraRuns.length ? 0 : i === extraRuns.length ? suggestions.length : i % 3 === 1 ? 1 : 0}</td>
                  <td><span className="pill ok">Completed</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
