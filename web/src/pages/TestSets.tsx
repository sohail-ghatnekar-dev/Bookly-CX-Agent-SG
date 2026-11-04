// Test › Test sets: the scripted conversations each AOP is tested against. For every test: what should happen, the
// conversation as it actually went on the last run, and each check with whether it passed.
import { useEffect, useMemo, useState } from "react";
import { ConversationLog } from "../components/ConversationLog";
import { api, type Overview, type Scenario, type SimResult } from "../lib/api";
import { ago, aopTitle, SCENARIO_NAMES } from "../lib/format";
import { go } from "../lib/router";

type Status = "waiting" | "running" | SimResult;
const PARALLEL = 3;

export function TestSetsPage({ name }: { name?: string }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Record<string, Status>>({});
  const [lastRun, setLastRun] = useState<{ at: string; by: string; version: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [logId, setLogId] = useState<string | null>(null);

  useEffect(() => {
    api.overview().then(setOverview).catch((e: Error) => setError(e.message));
  }, []);

  // One test set per AOP that has scripted conversations.
  const sets = useMemo(() => {
    const byAop = new Map<string, Scenario[]>();
    for (const s of overview?.scenarios ?? []) byAop.set(s.procedure, [...(byAop.get(s.procedure) ?? []), s]);
    return [...byAop.entries()].map(([aop, tests]) => {
      const live = overview!.versions.find((v) => v.name === aop && v.is_active);
      return { aop, title: live?.title ?? aopTitle(aop), tests, live };
    });
  }, [overview]);
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
  const e = overview.latest_eval;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Test sets</h1>
        <span className="spacer" />
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
              ? <>Last run on v{lastRun.version} {ago(lastRun.at)} by {lastRun.by}: <b style={{ color: "var(--ink)" }}>{finished.filter((r) => r.passed).length}/{set.tests.length}</b> passed</>
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

      {set.tests.map((t) => <TestCard key={t.id} test={t} result={results[t.id]} onLog={setLogId} />)}
      {logId && <ConversationLog id={logId} onClose={() => setLogId(null)} />}
    </div>
  );
}

function TestCard({ test, result, onLog }: { test: Scenario; result?: Status; onLog: (id: string) => void }) {
  const r = typeof result === "object" ? result : null;
  const state = !result ? "idle" : typeof result === "string" ? result : result.passed ? "pass" : "fail";
  // Older runs stored only failures; then every check passed unless the run failed.
  const checks = r?.checks?.length ? r.checks : test.checks.map((check) => ({ check, passed: r ? r.passed : undefined, problem: undefined }));

  return (
    <div className="card test-card">
      <div className="scenario-top">
        <span className={`dot ${state}`} />
        <h2 style={{ margin: 0, flex: 1 }}>{SCENARIO_NAMES[test.id] ?? test.id}</h2>
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
