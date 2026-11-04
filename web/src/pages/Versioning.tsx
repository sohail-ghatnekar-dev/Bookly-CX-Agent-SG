// Versioning: every change to an AOP, who made it and when. Roll back from the AOP itself.
import { useEffect, useState } from "react";
import { api, type AuditEvent } from "../lib/api";
import { ago, aopTitle } from "../lib/format";

const ACTIONS: Record<AuditEvent["action"], string> = {
  created: "Created an AOP",
  draft_saved: "Saved a draft",
  draft_discarded: "Discarded a draft",
  retired: "Retired",
  simulation_run: "Ran simulations",
  published: "Published",
  rolled_back: "Rolled back",
};

export function VersioningPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.auditLog().then((r) => setEvents(r.events)).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="empty error">{error}</div>;
  if (!events) return <div className="empty muted">Loading…</div>;

  return (
    <div className="page">
      <div className="page-head"><h1>Versioning</h1></div>
      <p className="muted" style={{ margin: 0 }}>Every new AOP, draft, simulation run, publish, rollback and retirement: who did it and when, kept for security review.</p>
      <div className="card table-card">
        <table className="log">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>AOP</th><th>Detail</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="static">
                <td className="muted">{ago(e.created_at)}</td>
                <td>{e.actor}</td>
                <td>{e.action === "published" ? <span className="pill ok">{ACTIONS[e.action]}</span> : e.action === "rolled_back" ? <span className="pill warn">{ACTIONS[e.action]}</span> : ACTIONS[e.action]}</td>
                <td><a href={`#/build/aops/${e.procedure}`}>{e.title ?? aopTitle(e.procedure)}</a>{e.version ? <span className="mono muted"> v{e.version}</span> : ""}</td>
                <td className="muted">{e.detail || "–"}</td>
              </tr>
            ))}
            {events.length === 0 && <tr className="static"><td colSpan={5} className="muted">No changes yet. Save a draft from AOPs to start the log.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
