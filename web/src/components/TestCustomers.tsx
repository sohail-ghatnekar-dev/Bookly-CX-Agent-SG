// The made-up customers and orders from supabase/seed.sql, so a test chat has something real to look up.
import { useEffect, useState } from "react";
import { api, type TestOrder } from "../lib/api";

export function TestCustomers() {
  const [orders, setOrders] = useState<TestOrder[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.testCustomers().then((r) => setOrders(r.orders)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="card test-customers">
      <div className="eyebrow">Test customers</div>
      <p className="muted small">The agent verifies an order number with the email on that order. Returns: 30 days to change your mind, 60 if it arrived damaged, never for ebooks.</p>
      {error && <p className="error small">{error}</p>}
      {!orders && !error && <p className="muted small">Loading…</p>}
      {orders && (
        <table className="log">
          <tbody>
            {orders.map((o) => (
              <tr key={o.order_number} className="static">
                <td className="mono">{o.order_number}</td>
                <td className="small">
                  {o.email}
                  <div className="muted">{o.items.join(", ")} · {o.delivered_days_ago !== null ? `delivered ${o.delivered_days_ago} days ago` : o.status}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
