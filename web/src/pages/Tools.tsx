// Build › Tools: the actions AOPs can reference with @. Each is code engineering owns, with its guardrails built in.
import { useEffect, useState } from "react";
import { api, type Overview } from "../lib/api";
import { aopTitle } from "../lib/format";

// What each tool enforces in code, whatever an AOP says.
const GUARDRAILS: Record<string, string> = {
  select_procedure: "Only live AOPs (or the one under test) can be picked.",
  verify_customer: "Order number and email must match. Locks after 3 wrong tries and never says which part was wrong.",
  list_orders: "Verified customer only. Lists only that customer's orders.",
  get_order_status: "Verified customer only. Someone else's order looks the same as one that doesn't exist.",
  check_return_eligibility: "Return windows live in code: 30 days to change your mind, 60 if damaged, never ebooks, delivered orders only.",
  initiate_return: "Re-runs the eligibility check before it issues an RMA, so no AOP can approve an out-of-policy return. One return per item.",
  get_policy: "Answers come from Bookly's policy documents. Cited IDs are checked against them.",
  escalate_to_human: "Needs a summary. The case goes to an employee with every rule that applied.",
};

export function ToolsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.overview().then(setOverview).catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <div className="empty error">{error}</div>;

  const live = overview?.versions.filter((v) => v.is_active) ?? [];

  return (
    <div className="page">
      <div className="page-head"><h1>Tools</h1></div>
      <p className="muted" style={{ margin: 0, maxWidth: 780 }}>
        The actions an AOP can take, connected to Bookly's order and returns systems. CX references them in AOPs with @; engineering owns the code
        and the guardrails in it. An AOP can only call the tools it references; anything else is refused and counted in Watchtowers.
      </p>
      <div className="card table-card">
        <table className="log">
          <thead><tr><th>Tool</th><th>What it does</th><th>Guardrails in code</th><th>Used by live AOPs</th></tr></thead>
          <tbody>
            {!overview && <tr><td colSpan={4} className="muted">Loading…</td></tr>}
            {overview?.tools.map((t) => {
              const users = live.filter((v) => v.tools.includes(t.name));
              return (
                <tr key={t.name}>
                  <td style={{ whiteSpace: "nowrap" }}><span className="mono ref-tool" style={{ padding: "1px 6px" }}>@{t.name}</span></td>
                  <td className="small">{t.description}</td>
                  <td className="tool-row-guard">{GUARDRAILS[t.name] ?? "–"}</td>
                  <td>
                    {t.always_on ? <span className="pill info">Every AOP</span> : users.length ? (
                      <div className="ref-list">{users.map((v) => <a key={v.name} className="mono ref-aop chip-ref" href={`#/build/aops/${v.name}`} title={v.title ?? aopTitle(v.name)}>#{v.name}</a>)}</div>
                    ) : <span className="muted">–</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
