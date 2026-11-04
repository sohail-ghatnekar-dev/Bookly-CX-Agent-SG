// Every change to an AOP: who saved, tested, published or rolled back which version, and when.
import { useEffect, useState } from "react";
import { api, type AuditEvent } from "../lib/api";
import { AOP_NAMES, ago } from "../lib/format";

const ACTIONS: Record<AuditEvent["action"], string> = {
  draft_saved: "Saved a draft",
  simulation_run: "Ran simulations",
  published: "Published",
  rolled_back: "Rolled back",
};

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.auditLog().then((r) => setEvents(r.events)).catch((e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="empty error">{error}</div>;
  if (!events) return <div className="empty muted">Loading…</div>;

  return (
    <div className="audit">
      <div className="eyebrow">Audit log</div>
      <h1>Who changed what, and when</h1>
      <p className="muted">Every draft, test, publish and rollback, kept for security review.</p>
      <div className="card">
        <table className="log">
          <thead><tr><th>When</th><th>Who</th><th>What</th><th>AOP</th><th>Detail</th></tr></thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id} className="static">
                <td className="muted">{ago(e.created_at)}</td>
                <td>{e.actor}</td>
                <td>{e.action === "published" ? <span className="pill ok">{ACTIONS[e.action]}</span> : e.action === "rolled_back" ? <span className="pill warn">{ACTIONS[e.action]}</span> : ACTIONS[e.action]}</td>
                <td className="mono">{AOP_NAMES[e.procedure] ?? e.procedure}{e.version ? ` v${e.version}` : ""}</td>
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
