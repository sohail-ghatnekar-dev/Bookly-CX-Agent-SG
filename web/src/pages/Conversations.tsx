// Conversations: every chat, newest first. Open one for the full log: what was said, and every step with its input,
// output and rule. Test chats from Preview are kept separate from live ones.
import { useEffect, useState } from "react";
import { ConversationLog } from "../components/ConversationLog";
import { api, type ConversationSummary } from "../lib/api";
import { ago } from "../lib/format";

export function ConversationsPage() {
  const [source, setSource] = useState<"live" | "test">("live");
  const [rows, setRows] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState("");
  const [logId, setLogId] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    api.conversations(source).then((r) => setRows(r.conversations)).catch((e: Error) => setError(e.message));
  }, [source]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Conversations</h1>
        <span className="spacer" />
        <div className="segmented" role="tablist">
          <button role="tab" aria-selected={source === "live"} className={source === "live" ? "active" : ""} onClick={() => setSource("live")}>Live</button>
          <button role="tab" aria-selected={source === "test"} className={source === "test" ? "active" : ""} onClick={() => setSource("test")}>Preview chats</button>
        </div>
      </div>
      {error && <div className="notice bad">{error}</div>}
      <div className="card table-card">
        <table className="log">
          <thead><tr><th>When</th><th>Conversation</th><th>AOP</th><th>Verified</th><th>Outcome</th><th>Handoff reason</th><th>Steps</th><th>Guardrails</th></tr></thead>
          <tbody>
            {!rows && !error && <tr><td colSpan={8} className="muted">Loading…</td></tr>}
            {rows?.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => setLogId(r.id)}>
                <td className="muted">{ago(r.created_at)}</td>
                <td className="mono">{r.id.slice(0, 8)}</td>
                <td className="mono">{r.aop ?? "–"}</td>
                <td>{r.verified ? "Yes" : "No"}</td>
                <td>{r.status === "escalated" ? <span className="pill warn">Employee</span> : <span className="pill ok">Agent</span>}</td>
                <td className="small muted">{r.handoff ?? "–"}</td>
                <td className="mono">{r.steps}</td>
                <td>{r.guards.length ? <div className="ref-list">{r.guards.map((g) => <span key={g} className="pill bad">{g}</span>)}</div> : <span className="muted">–</span>}</td>
              </tr>
            ))}
            {rows?.length === 0 && (
              <tr><td colSpan={8} className="muted">{source === "test" ? "No Preview chats yet." : "No live conversations in the last 30 days."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {logId && <ConversationLog id={logId} onClose={() => setLogId(null)} />}
    </div>
  );
}
