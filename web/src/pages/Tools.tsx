// Build › Tools: the actions AOPs can reference with @, with whether a live AOP uses each one, who owns it and when
// it last changed. Open a tool for its inputs and guardrails; add a new one as a request to engineering.
import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";
import { api, type CustomTool, type Overview, type Tool } from "../lib/api";
import { ago, aopTitle } from "../lib/format";

// What each tool enforces in code, whatever an AOP says.
const GUARDRAILS: Record<string, string> = {
  select_procedure: "Only live AOPs (or the one under test) can be picked.",
  verify_customer: "Order number and email must match. Locks after 3 wrong tries and never says which part was wrong.",
  list_orders: "Verified customer only. Lists only that customer's orders.",
  get_order_status: "Verified customer only. Someone else's order looks the same as one that doesn't exist.",
  check_return_eligibility: "Return windows live in code: 30 days to change your mind, 60 if damaged, never ebooks, delivered orders only.",
  initiate_return: "Re-runs the eligibility check before it issues an RMA, so no AOP can approve an out-of-policy return. One return per item.",
  get_policy: "Answers come from Bookly's policy documents. Cited IDs are checked against them.",
  schedule_follow_up: "Verified customer and their own order only. Emails the address on the account, never one typed in chat. One pending follow-up per order.",
  escalate_to_human: "Needs a summary. The case goes to an employee with every rule that applied.",
};

// Who owns each built-in tool, and when it last changed.
const OWNERS: Record<string, { creator: string; updated: string }> = {
  select_procedure: { creator: "platform@bookly.com", updated: "2026-10-21T15:00:00Z" },
  verify_customer: { creator: "orders-eng@bookly.com", updated: "2026-10-30T18:20:00Z" },
  list_orders: { creator: "orders-eng@bookly.com", updated: "2026-10-24T16:05:00Z" },
  get_order_status: { creator: "orders-eng@bookly.com", updated: "2026-10-29T20:40:00Z" },
  check_return_eligibility: { creator: "returns-eng@bookly.com", updated: "2026-10-28T17:10:00Z" },
  initiate_return: { creator: "returns-eng@bookly.com", updated: "2026-10-28T17:30:00Z" },
  get_policy: { creator: "cx-ops@bookly.com", updated: "2026-10-22T14:00:00Z" },
  schedule_follow_up: { creator: "orders-eng@bookly.com", updated: "2026-11-02T16:45:00Z" },
  escalate_to_human: { creator: "platform@bookly.com", updated: "2026-10-23T19:15:00Z" },
};

const TYPES: Record<CustomTool["type"], string> = { coded: "Coded Tool", api: "API Call", integration: "Integration" };

interface Row {
  name: string;
  description: string;
  status: "Used" | "Unused";
  type: string;
  creator: string;
  updated: string;
  usedBy: { name: string; title: string }[];
  everyAop: boolean;
  guardrails: string;
  inputs: { name: string; type: string; required: boolean; description: string }[];
  endpoint?: string;
  pending: boolean; // added here, not built yet
}

function builtIn(t: Tool, overview: Overview): Row {
  const live = overview.versions.filter((v) => v.is_active && v.tools.includes(t.name));
  const props = t.input_schema?.properties ?? {};
  return {
    name: t.name,
    description: t.description,
    status: t.always_on || live.length ? "Used" : "Unused",
    type: t.always_on ? "Built-in" : "Coded Tool",
    creator: OWNERS[t.name]?.creator ?? "platform@bookly.com",
    updated: OWNERS[t.name]?.updated ?? "2026-10-21T15:00:00Z",
    usedBy: live.map((v) => ({ name: v.name, title: v.title ?? aopTitle(v.name) })),
    everyAop: t.always_on,
    guardrails: GUARDRAILS[t.name] ?? "",
    inputs: Object.entries(props).map(([name, p]) => ({
      name,
      type: p.enum ? p.enum.join(" | ") : p.type ?? "string",
      required: (t.input_schema?.required ?? []).includes(name),
      description: p.description ?? "",
    })),
    pending: false,
  };
}

function custom(t: CustomTool): Row {
  return {
    name: t.name,
    description: t.description,
    status: "Unused",
    type: TYPES[t.type],
    creator: t.created_by,
    updated: t.created_at,
    usedBy: [],
    everyAop: false,
    guardrails: t.guardrails,
    inputs: t.inputs,
    endpoint: t.method && t.url ? `${t.method} ${t.url}` : undefined,
    pending: true,
  };
}

export function ToolsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);

  const load = () => api.overview().then(setOverview).catch((e: Error) => setError(e.message));
  useEffect(() => void load(), []);
  if (error) return <div className="empty error">{error}</div>;

  const rows: Row[] = overview
    ? [...overview.custom_tools.map(custom), ...overview.tools.map((t) => builtIn(t, overview))]
    : [];

  return (
    <div className="page">
      <div className="page-head">
        <h1>Tools</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setCreating(true)}><Icon name="plus" size={14} />New tool</button>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 780 }}>
        The actions an AOP can take, connected to Bookly's order and returns systems. CX references them in AOPs with @;
        engineering owns the code and the guardrails in it. An AOP can only call the tools it references.
      </p>
      <div className="card table-card">
        <table className="log tools-table">
          <thead><tr><th>Name</th><th>Status</th><th>Type</th><th>Creator</th><th>Updated</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {!overview && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
            {rows.map((r) => (
              <tr key={r.name} className="clickable" onClick={() => setOpen(r)}>
                <td><span className="mono ref-tool chip-ref">{r.name}</span>{r.pending && <span className="muted small" style={{ marginLeft: 8 }}>awaiting deploy</span>}</td>
                <td><span className={`status-pill ${r.status === "Used" ? "used" : "unused"}`}>{r.status}</span></td>
                <td><span className="type-pill">{r.type}</span></td>
                <td>{r.creator}</td>
                <td className="muted">{ago(r.updated)}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="kebab" aria-label={`Open ${r.name}`} onClick={(e) => { e.stopPropagation(); setOpen(r); }}>⋮</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <ToolDrawer row={open} onClose={() => setOpen(null)} />}
      {creating && <NewToolDrawer onClose={() => setCreating(false)} onCreated={async (t) => { setCreating(false); await load(); setOpen(custom(t)); }} />}
    </div>
  );
}

function ToolDrawer({ row: r, onClose }: { row: Row; onClose: () => void }) {
  return (
    <div className="drawer">
      <div className="drawer-head">
        <div>
          <div className="eyebrow">{r.type}</div>
          <h2 className="mono ref-tool" style={{ padding: "2px 8px", display: "inline-block", marginTop: 4 }}>@{r.name}</h2>
        </div>
        <button className="link" onClick={onClose}>Close</button>
      </div>
      <div className="chips">
        <span className={`status-pill ${r.status === "Used" ? "used" : "unused"}`}>{r.status}</span>
        <span className="chip">{r.creator}</span>
        <span className="chip">Updated {ago(r.updated)}</span>
      </div>
      {r.pending && <div className="notice" style={{ marginBottom: 14 }}>Requested here, not built yet. Engineering builds and deploys it; then CX can reference it in AOPs with @{r.name}.</div>}
      <h3>What it does</h3>
      <p>{r.description}</p>
      {r.endpoint && (<><h3>Endpoint</h3><p className="mono">{r.endpoint}</p></>)}
      <h3>Inputs</h3>
      {r.inputs.length === 0 ? <p className="muted small">None.</p> : (
        <table className="log" style={{ marginBottom: 16 }}>
          <thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Description</th></tr></thead>
          <tbody>
            {r.inputs.map((i) => (
              <tr key={i.name} className="static"><td className="mono">{i.name}</td><td className="mono muted">{i.type}</td><td>{i.required ? "Yes" : "No"}</td><td className="small">{i.description || "–"}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>Guardrails in code</h3>
      <p className="muted">{r.guardrails || "None yet."}</p>
      <h3>Used by live AOPs</h3>
      {r.everyAop ? <span className="pill info">Every AOP</span> : r.usedBy.length ? (
        <div className="ref-list">{r.usedBy.map((u) => <a key={u.name} className="mono ref-aop chip-ref" href={`#/build/aops/${u.name}`} title={u.title}>#{u.name}</a>)}</div>
      ) : <p className="muted small">No live AOP references it yet.</p>}
    </div>
  );
}

function NewToolDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (t: CustomTool) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<CustomTool["type"]>("api");
  const [method, setMethod] = useState("POST");
  const [url, setUrl] = useState("");
  const [inputs, setInputs] = useState([{ name: "order_number", type: "string", required: true, description: "Order number, e.g. BK-1042" }]);
  const [guardrails, setGuardrails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const setInput = (i: number, patch: Partial<(typeof inputs)[number]>) => setInputs((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function save() {
    setBusy(true);
    setError("");
    try {
      const { tool } = await api.createTool({ name, description, type, method, url, inputs: inputs.filter((i) => i.name.trim()), guardrails });
      onCreated(tool);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="drawer">
      <div className="drawer-head">
        <div><div className="eyebrow">Build › Tools</div><h2>New tool</h2></div>
        <button className="link" onClick={onClose}>Cancel</button>
      </div>
      <p className="muted small">Describe the action and how to reach it. Engineering builds it with the guardrails you list, and it appears here as unused until a live AOP references it.</p>
      <div className="form">
        <label className="field-row"><span>Name</span>
          <input className="text-input mono" value={name} placeholder="e.g. send_tracking_text" maxLength={40} onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} />
        </label>
        <label className="field-row"><span>What it does</span>
          <textarea className="text-area" rows={3} value={description} maxLength={500} placeholder="Tell the agent what it does and when to use it." onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="field-row"><span>Type</span>
          <select className="select" value={type} onChange={(e) => setType(e.target.value as CustomTool["type"])}>
            <option value="api">API call: an HTTP endpoint</option>
            <option value="coded">Coded tool: engineering writes the function</option>
            <option value="integration">Integration: a connected system</option>
          </select>
        </label>
        {type === "api" && (
          <label className="field-row"><span>Endpoint</span>
            <div className="row">
              <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>{["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => <option key={m}>{m}</option>)}</select>
              <input className="text-input mono" value={url} placeholder="https://api.bookly.com/v1/…" onChange={(e) => setUrl(e.target.value)} />
            </div>
          </label>
        )}
        <div className="field-row"><span>Inputs</span>
          <div className="inputs-list">
            {inputs.map((i, n) => (
              <div key={n} className="input-row">
                <input className="text-input mono" value={i.name} placeholder="name" onChange={(e) => setInput(n, { name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} />
                <select className="select" value={i.type} onChange={(e) => setInput(n, { type: e.target.value })}><option>string</option><option>number</option><option>boolean</option></select>
                <label className="row small"><input type="checkbox" checked={i.required} onChange={(e) => setInput(n, { required: e.target.checked })} />Required</label>
                <input className="text-input" value={i.description} placeholder="What the agent should pass" onChange={(e) => setInput(n, { description: e.target.value })} />
                <button className="ghost" aria-label="Remove input" onClick={() => setInputs((xs) => xs.filter((_, j) => j !== n))}>×</button>
              </div>
            ))}
            {inputs.length < 10 && <button className="link small" style={{ alignSelf: "flex-start" }} onClick={() => setInputs((xs) => [...xs, { name: "", type: "string", required: false, description: "" }])}>+ Add input</button>}
          </div>
        </div>
        <label className="field-row"><span>Guardrails</span>
          <textarea className="text-area" rows={2} value={guardrails} maxLength={500} placeholder="What the code must check, whatever an AOP says. e.g. Verified customer only." onChange={(e) => setGuardrails(e.target.value)} />
        </label>
        {error && <div className="notice bad">{error}</div>}
        <div className="row-end"><button className="primary" disabled={busy || !name || !description} onClick={save}>{busy ? "Saving…" : "Create tool"}</button></div>
      </div>
    </div>
  );
}
