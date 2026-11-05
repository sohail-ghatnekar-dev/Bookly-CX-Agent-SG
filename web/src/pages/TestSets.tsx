// Test › Test sets: the scripted conversations each AOP is tested against. For every test: what should happen, the
// conversation as it actually went on the last run, and each check with whether it passed. Tests added with New test
// are kept in this browser and shown in their set; they don't run in this demo.
import { useEffect, useMemo, useState } from "react";
import { ConversationLog } from "../components/ConversationLog";
import { api, type Overview, type Scenario, type SimResult } from "../lib/api";
import { ago, aopTitle, SCENARIO_NAMES } from "../lib/format";
import { go } from "../lib/router";

type Status = "waiting" | "running" | SimResult;
type Test = Scenario & { title?: string; added?: string }; // added: when New test made it
const PARALLEL = 3;
const ADDED_KEY = "bookly.added-tests";

function loadAdded(): Test[] {
  try {
    return JSON.parse(localStorage.getItem(ADDED_KEY) ?? "[]") as Test[];
  } catch {
    return [];
  }
}

function saveAdded(tests: Test[]) {
  try {
    localStorage.setItem(ADDED_KEY, JSON.stringify(tests));
  } catch {
    // Storage can be off (a private window); the test still shows until the page reloads.
  }
}

export function TestSetsPage({ name }: { name?: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, Status>>({});
  const [lastRun, setLastRun] = useState<{ at: string; by: string; version: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);
  const [added, setAdded] = useState<Test[]>(loadAdded);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.overview().then(setOverview).catch((e: Error) => setError(e.message));
  }, []);

  // One test set per AOP that has scripted conversations.
  const sets = useMemo(() => {
    const byAop = new Map<string, Test[]>();
    for (const s of [...(overview?.scenarios ?? []), ...added]) byAop.set(s.procedure, [...(byAop.get(s.procedure) ?? []), s]);
    return [...byAop.entries()].map(([aop, tests]) => {
      const live = overview!.versions.find((v) => v.name === aop && v.is_active);
      return { aop, title: live?.title ?? aopTitle(aop), tests, live };
    });
  }, [overview, added]);

  function addTest(t: Test) {
    const next = [...added, t];
    setAdded(next);
    saveAdded(next);
    setCreating(false);
    go(`#/test/sets/${t.procedure}`);
  }

  function removeTest(id: string) {
    const next = added.filter((t) => t.id !== id);
    setAdded(next);
    saveAdded(next);
  }
  const set = sets.find((s) => s.aop === name) ?? sets[0];

  // Load the last run on the live version of this set's AOP.
  useEffect(() => {
    setResults({});
    setLastRun(null);
    const runId = set?.live?.latest_run;
    if (!runId) return;
    api.runGet(runId).then(({ run, results: rs }) => {
      setResults(Object.fromEntries(rs.map((r) => [r.scenario_id, r])));
      setLastRun({ at: run.created_at, by: run.started_by, version: run.version });
    }).catch(() => {});
  }, [set?.aop, set?.live?.latest_run]);

  async function runSet() {
    if (!set?.live) return;
    setRunning(true);
    try {
      const { run_id, scenarios: ids } = await api.runStart(set.aop, set.live.version);
      setResults(Object.fromEntries(ids.map((id) => [id, "waiting" as Status])));
      const queue = [...ids];
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          setResults((r) => ({ ...r, [id!]: "running" }));
          const result = await api.runScenario(run_id, id).catch((e: Error): SimResult => ({
            scenario_id: id!, passed: false, outcome: "failed", failures: [e.message], replies: [], conversation_id: null, ms: 0,
          }));
          setResults((r) => ({ ...r, [id!]: result }));
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      setLastRun({ at: new Date().toISOString(), by: "you", version: set.live.version });
      setOverview(await api.overview());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (error) return <div className="empty error">{error}</div>;
  if (!overview || !set) return <div className="empty muted">Loading…</div>;

  const finished = set.tests.map((t) => results[t.id]).filter((r): r is SimResult => typeof r === "object");
  const scripted = set.tests.filter((t) => !t.added).length;
  const e = overview.latest_eval;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Test sets</h1>
        <span className="spacer" />
        <button className="secondary" onClick={() => setCreating(true)}>New test</button>
        {e && <span className="muted small">Full suite, every AOP × repeats: <b style={{ color: "var(--ink)" }}>{e.passed}/{e.total}</b> passed {ago(e.ran_at)} on {e.model}</span>}
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 820 }}>
        Scripted customer conversations, played against the real agent and checked against what it actually did (the trace) and what it
        changed (the database). No AI grading: every check is a yes or no.
      </p>
      <div className="tabs" role="tablist">
        {sets.map((s) => (
          <button key={s.aop} role="tab" aria-selected={s.aop === set.aop} className={`tab${s.aop === set.aop ? " active" : ""}`} onClick={() => go(`#/test/sets/${s.aop}`)}>
            {s.title} <span className="muted">· {s.tests.length}</span>
          </button>
        ))}
      </div>

      <div className="card row-between">
        <div>
          <h2 style={{ margin: 0 }}>{set.title} test set</h2>
          <div className="muted small">
            {lastRun
              ? <>Last run on v{lastRun.version} {ago(lastRun.at)} by {lastRun.by}: <b style={{ color: "var(--ink)" }}>{finished.filter((r) => r.passed).length}/{scripted}</b> passed</>
              : "Not run on the live version yet."}
          </div>
        </div>
        <div className="row">
          <a className="secondary" href={`#/build/aops/${set.aop}`} style={{ textDecoration: "none" }}>Open AOP</a>
          <button className="primary" disabled={running || !set.live} onClick={runSet}>
            {running ? "Running…" : `Run against live v${set.live?.version ?? "?"}`}
          </button>
        </div>
      </div>

      {set.tests.map((t) => <TestCard key={t.id} test={t} result={results[t.id]} onLog={setLogId} onRemove={t.added ? () => removeTest(t.id) : undefined} />)}
      {logId && <ConversationLog id={logId} onClose={() => setLogId(null)} />}
      {creating && (
        <NewTestDrawer
          aops={overview.versions.filter((v) => v.is_active).map((v) => ({ name: v.name, title: v.title ?? aopTitle(v.name) }))}
          initial={set.aop}
          tools={overview.tools.filter((t) => t.name !== "select_procedure").map((t) => t.name)}
          onClose={() => setCreating(false)}
          onCreated={addTest}
        />
      )}
    </div>
  );
}

function TestCard({ test, result, onLog, onRemove }: { test: Test; result?: Status; onLog: (id: string) => void; onRemove?: () => void }) {
  const r = typeof result === "object" ? result : null;
  const state = !result ? "idle" : typeof result === "string" ? result : result.passed ? "pass" : "fail";
  // Older runs stored only failures; then every check passed unless the run failed.
  const checks = r?.checks?.length ? r.checks : test.checks.map((check) => ({ check, passed: r ? r.passed : undefined, problem: undefined }));

  return (
    <div className="card test-card">
      <div className="scenario-top">
        <span className={`dot ${state}`} />
        <h2 style={{ margin: 0, flex: 1 }}>{test.title ?? SCENARIO_NAMES[test.id] ?? test.id}</h2>
        {test.added && <span className="pill info">New</span>}
        {test.added && <span className="muted small">Not run yet · added {ago(test.added)}</span>}
        {onRemove && <button className="link small" onClick={onRemove}>Remove</button>}
        {!test.gate && <span className="pill" title="Reported, not part of the pass bar">stat</span>}
        {r && <span className={`pill ${r.passed ? "ok" : "bad"}`}>{r.passed ? "Passed" : "Failed"}</span>}
        {r && <span className="muted small">{r.outcome === "escalated" ? "handed to an employee" : r.outcome} · {(r.ms / 1000).toFixed(1)}s</span>}
        {state === "running" && <span className="muted small">running…</span>}
        {state === "waiting" && <span className="muted small">queued</span>}
      </div>
      <p className="expect"><span className="eyebrow">Expected</span>{test.expect}</p>
      <div className="test-cols">
        <div>
          <div className="eyebrow">{r ? "How it went" : "Customer says"}</div>
          <div className="mini-chat">
            {test.turns.map((turn, i) => (
              <div key={i} className="mini-turn">
                <div className="mini-bubble user">{turn}</div>
                {r?.replies[i] && <div className="mini-bubble agent">{r.replies[i]}</div>}
              </div>
            ))}
          </div>
          {r?.conversation_id && <button className="link small" onClick={() => onLog(r.conversation_id!)}>Open the full log</button>}
        </div>
        <div>
          <div className="eyebrow">Checks</div>
          <ul className="checks">
            {checks.map((c, i) => (
              <li key={i} className={c.passed === undefined ? "" : c.passed ? "ok" : "bad"}>
                <span>{c.check}</span>
                {c.problem && <span className="problem">{c.problem}</span>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// The checks a new test can make, each a yes or no on what the agent did, like the scripted tests.
const CHECKS = [
  { id: "uses", label: "Uses a tool", needsTool: true, say: (tool: string) => `Uses @${tool}` },
  { id: "never", label: "Never uses a tool", needsTool: true, say: (tool: string) => `Never uses @${tool}` },
  { id: "handoff", label: "Hands the chat to an employee", needsTool: false, say: () => "The chat is handed to an employee" },
  { id: "resolves", label: "Resolves it without an employee", needsTool: false, say: () => "The agent resolves it without an employee" },
  { id: "flagged", label: "Nothing is flagged for review", needsTool: false, say: () => "Nothing is flagged for review" },
];

function NewTestDrawer({ aops, initial, tools, onClose, onCreated }: {
  aops: { name: string; title: string }[];
  initial: string;
  tools: string[];
  onClose: () => void;
  onCreated: (t: Test) => void;
}) {
  const [title, setTitle] = useState("");
  const [aop, setAop] = useState(aops.some((a) => a.name === initial) ? initial : aops[0]?.name ?? "");
  const [expect, setExpect] = useState("");
  const [turns, setTurns] = useState([""]);
  const [checks, setChecks] = useState([{ id: "uses", tool: tools[0] ?? "" }]);

  const setTurn = (i: number, text: string) => setTurns((xs) => xs.map((x, j) => (j === i ? text : x)));
  const setCheck = (i: number, patch: Partial<(typeof checks)[number]>) => setChecks((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const said = turns.map((t) => t.trim()).filter(Boolean);
  const ready = title.trim() && aop && expect.trim() && said.length > 0 && checks.length > 0;

  function create() {
    onCreated({
      id: `added_${Date.now()}`,
      title: title.trim(),
      procedure: aop,
      expect: expect.trim(),
      turns: said,
      checks: checks.map((c) => CHECKS.find((x) => x.id === c.id)!.say(c.tool)),
      gate: true,
      added: new Date().toISOString(),
    });
  }

  return (
    <div className="drawer">
      <div className="drawer-head">
        <div><div className="eyebrow">Test › Test sets</div><h2>New test</h2></div>
        <button className="link" onClick={onClose}>Cancel</button>
      </div>
      <p className="muted small">Script what a customer says and what the agent must do. Every check is a yes or no on the trace, like the tests already in each set.</p>
      <div className="form">
        <label className="field-row"><span>Name</span>
          <input className="text-input" value={title} maxLength={80} placeholder="e.g. Late order gets a follow-up, not a handoff" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field-row"><span>AOP</span>
          <select className="select" value={aop} onChange={(e) => setAop(e.target.value)}>
            {aops.map((a) => <option key={a.name} value={a.name}>{a.title}</option>)}
          </select>
        </label>
        <label className="field-row"><span>What should happen</span>
          <textarea className="text-area" rows={2} value={expect} maxLength={300} placeholder="In plain English, e.g. The agent verifies, explains the delay and schedules an email update." onChange={(e) => setExpect(e.target.value)} />
        </label>
        <div className="field-row"><span>Customer says</span>
          <div className="inputs-list">
            {turns.map((t, i) => (
              <div key={i} className="row">
                <span className="muted small" style={{ width: 18 }}>{i + 1}</span>
                <input className="text-input" value={t} maxLength={500} placeholder={i === 0 ? "My order still hasn't arrived. BK-1072, daniel.okafor@example.com" : "Next message"} onChange={(e) => setTurn(i, e.target.value)} />
                {turns.length > 1 && <button className="ghost" aria-label="Remove message" onClick={() => setTurns((xs) => xs.filter((_, j) => j !== i))}>×</button>}
              </div>
            ))}
            {turns.length < 6 && <button className="link small" style={{ alignSelf: "flex-start" }} onClick={() => setTurns((xs) => [...xs, ""])}>+ Add message</button>}
          </div>
        </div>
        <div className="field-row"><span>Checks</span>
          <div className="inputs-list">
            {checks.map((c, i) => {
              const kind = CHECKS.find((x) => x.id === c.id)!;
              return (
                <div key={i} className="row">
                  <select className="select" value={c.id} onChange={(e) => setCheck(i, { id: e.target.value })}>
                    {CHECKS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                  {kind.needsTool && (
                    <select className="select mono" value={c.tool} onChange={(e) => setCheck(i, { tool: e.target.value })}>
                      {tools.map((t) => <option key={t} value={t}>@{t}</option>)}
                    </select>
                  )}
                  {checks.length > 1 && <button className="ghost" aria-label="Remove check" onClick={() => setChecks((xs) => xs.filter((_, j) => j !== i))}>×</button>}
                </div>
              );
            })}
            {checks.length < 8 && <button className="link small" style={{ alignSelf: "flex-start" }} onClick={() => setChecks((xs) => [...xs, { id: "resolves", tool: tools[0] ?? "" }])}>+ Add check</button>}
          </div>
        </div>
        <div className="row-end"><button className="primary" disabled={!ready} onClick={create}>Add test</button></div>
      </div>
    </div>
  );
}
