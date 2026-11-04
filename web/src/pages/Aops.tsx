// Build, test, iterate: edit an AOP draft in plain English, run the simulations against it, publish when they pass.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConversationLog } from "../components/ConversationLog";
import { api, type Overview, type SimResult, type Version } from "../lib/api";
import { AOP_NAMES, ago, diffLines, SCENARIO_NAMES, toolsIn } from "../lib/format";

type Step = "build" | "test" | "publish";
type Status = "waiting" | "running" | SimResult;
const PARALLEL = 3;

export function AopsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [name, setName] = useState("returns");
  const [step, setStep] = useState<Step>("build");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [showDiff, setShowDiff] = useState(true);
  const [run, setRun] = useState<{ version: number; results: Record<string, Status> } | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setOverview(await api.overview());
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const versions = useMemo(() => overview?.versions.filter((v) => v.name === name) ?? [], [overview, name]);
  const active = versions.find((v) => v.is_active);
  const draft = versions.find((v) => !v.published_at);
  const target = draft ?? active; // the version a test or publish acts on
  const scenarios = overview?.scenarios.filter((s) => s.procedure === name) ?? [];

  // When the AOP or its draft changes, load its text and the last test of that version.
  useEffect(() => {
    if (!target) return;
    setText(target.body);
    setNote(draft?.note ?? "");
    setDirty(false);
    setRun(null);
    if (target.latest_run) {
      api.runGet(target.latest_run).then(({ run: r, results }) => {
        if (new Date(r.created_at) < new Date(target.created_at)) return; // a test of older text
        setRun({ version: target.version, results: Object.fromEntries(results.map((x) => [x.scenario_id, x])) });
      }).catch(() => {});
    }
  }, [target?.name, target?.version, target?.created_at, target?.published_at]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(next: string) {
    setName(next);
    go("build");
    setMessage("");
  }

  function go(next: Step) {
    setStep(next);
    window.scrollTo({ top: 0 });
  }

  async function save() {
    if (!text.trim().toLowerCase().startsWith("goal:")) {
      setMessage('Start the AOP with a "Goal:" line.');
      return;
    }
    setBusy("save");
    setMessage("");
    try {
      const saved = await api.saveDraft(name, text, note);
      await load();
      setMessage(`Saved as draft v${saved.version}. Next: run the simulations.`);
      go("test");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function runSimulations() {
    if (!target) return;
    setBusy("test");
    setMessage("");
    try {
      const { run_id, scenarios: ids } = await api.runStart(name, target.version);
      const results: Record<string, Status> = Object.fromEntries(ids.map((id) => [id, "waiting" as Status]));
      setRun({ version: target.version, results: { ...results } });
      const queue = [...ids];
      const worker = async () => {
        for (let id = queue.shift(); id; id = queue.shift()) {
          setRun((r) => r && { ...r, results: { ...r.results, [id!]: "running" } });
          const result = await api.runScenario(run_id, id).catch((e: Error): SimResult => ({
            scenario_id: id!, passed: false, outcome: "failed", failures: [e.message], replies: [], conversation_id: null, ms: 0,
          }));
          setRun((r) => r && { ...r, results: { ...r.results, [id!]: result } });
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      await load();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function publish() {
    if (!draft) return;
    setBusy("publish");
    setMessage("");
    try {
      const { previous } = await api.publish(name, draft.version);
      await load();
      setMessage(`v${draft.version} is live${previous ? `, replacing v${previous}` : ""}. Watch it in Watchtower.`);
      go("build");
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  async function rollback(v: Version) {
    setBusy(`rollback-${v.version}`);
    setMessage("");
    try {
      const { previous } = await api.rollback(name, v.version);
      await load();
      setMessage(`Rolled back to v${v.version}${previous ? ` from v${previous}` : ""}.`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  if (error) return <div className="empty error">{error}</div>;
  if (!overview || !target) return <div className="empty muted">Loading AOPs…</div>;

  const toolNames = overview.tools.map((t) => t.name);
  const used = toolsIn(text, toolNames);
  const results = run && run.version === target.version ? run.results : null;
  const finished = results ? Object.values(results).filter((r): r is SimResult => typeof r === "object") : [];
  const gated = scenarios.filter((s) => s.gate);
  const allPassed = !!results && gated.every((s) => {
    const r = results[s.id];
    return typeof r === "object" && r.passed;
  });
  const canPublish = !!draft && !dirty && allPassed && busy === "";

  return (
    <div className="aops">
      <div className="aop-list">
        <div className="eyebrow">AOPs</div>
        {Object.keys(AOP_NAMES).map((n) => {
          const vs = overview.versions.filter((v) => v.name === n);
          const live = vs.find((v) => v.is_active);
          const hasDraft = vs.some((v) => !v.published_at);
          return (
            <button key={n} className={`aop-item${n === name ? " active" : ""}`} onClick={() => pick(n)}>
              <span>{AOP_NAMES[n]}</span>
              <span className="aop-meta">
                {live && <span className="pill ok">live v{live.version}</span>}
                {hasDraft && <span className="pill draft">draft</span>}
              </span>
            </button>
          );
        })}
        <div className="eyebrow spaced">Versions</div>
        {versions.map((v) => (
          <div key={v.version} className={`version${v.version === target.version ? " current" : ""}`}>
            <div className="version-top">
              <span className="mono">v{v.version}</span>
              {v.is_active ? <span className="pill ok">live</span> : v.published_at ? <span className="pill">published</span> : <span className="pill draft">draft</span>}
            </div>
            <div className="muted small">{v.author ?? "Bookly CX"} · {ago(v.published_at ?? v.created_at)}</div>
            {v.note && <div className="small">{v.note}</div>}
            {v.published_at && !v.is_active && (
              <button className="link small" disabled={busy !== ""} onClick={() => rollback(v)}>
                {busy === `rollback-${v.version}` ? "Rolling back…" : "Roll back to this version"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="aop-main">
        <div className="aop-head">
          <div>
            <div className="eyebrow">Agent Operating Procedure</div>
            <h1>{AOP_NAMES[name]}</h1>
          </div>
          <div className="stepper">
            {(["build", "test", "publish"] as Step[]).map((s, i) => (
              <button key={s} className={`stepper-item${step === s ? " active" : ""}`} onClick={() => go(s)}>
                <span className="stepper-n">{i + 1}</span>
                {s === "build" ? "Build" : s === "test" ? "Test" : "Publish"}
              </button>
            ))}
          </div>
        </div>

        {message && <div className="notice">{message}</div>}

        {step === "build" && (
          <div className="build">
            <div className="editor-col">
              <div className="row-between">
                <div className="muted">
                  {draft ? `Editing draft v${draft.version}` : `Live v${active?.version}. Saving creates a draft; customers keep v${active?.version} until you publish.`}
                </div>
                <label className="toggle"><input type="checkbox" checked={showDiff} onChange={(e) => setShowDiff(e.target.checked)} /> Show changes</label>
              </div>
              <textarea className="editor" spellCheck value={text} onChange={(e) => { setText(e.target.value); setDirty(true); setMessage(""); }} />
              <div className="save-row">
                <input className="note" placeholder="What changed, in a few words" value={note} maxLength={200} onChange={(e) => { setNote(e.target.value); setDirty(true); }} />
                <button className="primary" disabled={busy !== "" || (!dirty && !!draft) || (!draft && text === active?.body)} onClick={save}>
                  {busy === "save" ? "Saving…" : draft ? "Save draft" : "Save as new draft"}
                </button>
              </div>
              {showDiff && active && text !== active.body && (
                <div className="diff">
                  <div className="eyebrow">Changes from live v{active.version}</div>
                  {diffLines(active.body, text).filter((l) => l.kind !== "same").map((l, i) => (
                    <div key={i} className={`diff-line ${l.kind}`}>{l.kind === "add" ? "+ " : "− "}{l.text}</div>
                  ))}
                </div>
              )}
            </div>
            <div className="tools-col">
              <div className="card">
                <div className="eyebrow">Tools this AOP calls</div>
                <p className="muted small">Code your engineers own. The AOP can only act through these, and each checks identity and policy itself.</p>
                {overview.tools.filter((t) => t.name !== "select_procedure").map((t) => (
                  <div key={t.name} className={`tool${used.includes(t.name) ? " used" : ""}`}>
                    <div className="mono">{t.name}</div>
                    <div className="small muted">{t.description}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === "test" && (
          <div className="test">
            <div className="row-between">
              <div>
                <h2>Simulations on v{target.version}{draft ? " (draft)" : " (live)"}</h2>
                <p className="muted">Each one plays a scripted reader conversation against this exact version, then checks the trace and the database. No AI grading.</p>
              </div>
              <button className="primary" disabled={busy !== "" || dirty} onClick={runSimulations}>
                {busy === "test" ? "Running…" : results ? "Run again" : `Run ${scenarios.length} simulations`}
              </button>
            </div>
            {dirty && <div className="notice">Save the draft first, so the simulations test what you see.</div>}
            {results && (
              <div className="tally">
                <span className="big">{finished.filter((r) => r.passed).length}/{scenarios.length}</span> passed
                <span className="muted"> · {finished.filter((r) => r.outcome === "resolved").length} resolved · {finished.filter((r) => r.outcome === "escalated").length} handed to a person</span>
              </div>
            )}
            <div className="scenarios">
              {scenarios.map((s) => {
                const r = results?.[s.id];
                const state = !r ? "idle" : typeof r === "string" ? r : r.passed ? "pass" : "fail";
                return (
                  <div key={s.id} className={`scenario ${state}`}>
                    <div className="scenario-top">
                      <span className={`dot ${state}`} />
                      <span className="scenario-name">{SCENARIO_NAMES[s.id] ?? s.id}</span>
                      {!s.gate && <span className="pill">stat</span>}
                      <span className="muted small">{state === "running" ? "running…" : state === "waiting" ? "queued" : typeof r === "object" ? `${r.outcome} · ${(r.ms / 1000).toFixed(1)}s` : ""}</span>
                    </div>
                    <div className="turns">
                      {s.turns.map((t, i) => <span key={i} className="turn">“{t}”</span>)}
                    </div>
                    {typeof r === "object" && r.failures.length > 0 && (
                      <ul className="failures">{r.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>
                    )}
                    {typeof r === "object" && r.replies.length > 0 && (
                      <div className="reply-preview">Last reply: {r.replies.at(-1)}</div>
                    )}
                    {typeof r === "object" && r.conversation_id && (
                      <button className="link small" onClick={() => setLogId(r.conversation_id)}>View the trace</button>
                    )}
                  </div>
                );
              })}
            </div>
            {results && finished.length === scenarios.length && (
              <div className="row-end">
                <button className="primary" disabled={!allPassed || !draft} onClick={() => go("publish")}>
                  {allPassed ? (draft ? "Continue to publish" : "Live version passes") : "Fix the AOP, then run again"}
                </button>
              </div>
            )}
          </div>
        )}

        {step === "publish" && (
          <div className="publish">
            <h2>{draft ? `Publish draft v${draft.version}` : "Nothing to publish"}</h2>
            {draft ? (
              <>
                <ul className="gate">
                  <li className={!dirty ? "ok" : ""}>Draft saved, no unsaved edits</li>
                  <li className={results ? "ok" : ""}>Simulations run on this exact text</li>
                  <li className={allPassed ? "ok" : ""}>Every gated simulation passed ({gated.length})</li>
                </ul>
                <p className="muted">Publishing makes v{draft.version} live for every reader on chat. v{active?.version} stays in the history, one click to roll back. The change is written to the audit log.</p>
                <button className="primary" disabled={!canPublish} onClick={publish}>{busy === "publish" ? "Publishing…" : `Publish v${draft.version}`}</button>
              </>
            ) : (
              <p className="muted">Edit the AOP in Build and save a draft first.</p>
            )}
          </div>
        )}
      </div>
      {logId && <ConversationLog id={logId} onClose={() => setLogId(null)} />}
    </div>
  );
}
