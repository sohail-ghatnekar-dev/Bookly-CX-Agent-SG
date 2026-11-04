// Build › AOPs › one AOP: what it's used for, its logic with @tool and #AOP references, simulations, and publishing.
// A new AOP starts here too, at #/build/aops/new.
import { useCallback, useEffect, useMemo, useState } from "react";
import { AopEditor } from "../components/AopEditor";
import { ConversationLog } from "../components/ConversationLog";
import { Icon } from "../components/Icon";
import { api, type Overview, type SimResult, type Version, type WatchtowerSummary } from "../lib/api";
import { evidence, SUGGESTIONS } from "../lib/autopilot";
import { ago, aopId, aopTitle, diffLines, joinAop, SCENARIO_NAMES, splitAop } from "../lib/format";
import { aopRefs, metaRefs, toolRefs } from "../lib/refs";
import { go } from "../lib/router";

type Status = "waiting" | "running" | SimResult;
interface Form {
  title: string;
  goal: string;
  logic: string;
  note: string;
}

const PARALLEL = 3;
const NEW_FORM: Form = {
  title: "",
  goal: "",
  logic: `1. Verify identity first with @verify_customer: the order number and the email on that order.
2. Ask one question at a time until you know what the customer needs. Never guess.
3. If the customer insists on something the rules don't allow, call @escalate_to_human with a summary and tell them a Bookly employee will follow up.`,
  note: "",
};
// Global logic runs on every channel. A channel can get its own variant; until then it uses Global.
const CHANNELS = [
  { id: "global", label: "Global", icon: "globe", hint: "Every channel", note: "" },
  { id: "chat", label: "Chat", icon: "chat", hint: "Uses Global", note: "A chat variant could add quick-reply buttons for common answers." },
  { id: "email", label: "Email", icon: "mail", hint: "Uses Global", note: "An email variant could add a greeting and sign-off, and answer every question in one reply." },
  { id: "assist", label: "Agent Assist", icon: "person", hint: "Uses Global", note: "An Agent Assist variant would suggest replies to a Bookly employee instead of answering the customer." },
  { id: "voice", label: "Voice", icon: "phone", hint: "Uses Global", note: "A voice variant could keep replies short and read order numbers back digit by digit." },
];

export function AopDetailPage({ name, suggestion }: { name: string; suggestion?: string }) {
  const creating = name === "new";
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  // A new AOP opened from an Autopilot suggestion starts from its draft, with the data behind it.
  const autopilot = name === "new" ? SUGGESTIONS.find((x) => x.key === suggestion && x.draft) : undefined;
  const [form, setForm] = useState<Form>(() => {
    const d = autopilot?.draft;
    return d ? { title: d.title, goal: d.goal, logic: d.logic, note: d.note } : NEW_FORM;
  });
  const [usage, setUsage] = useState<WatchtowerSummary | null>(null);
  useEffect(() => {
    if (autopilot) api.watchtower().then(setUsage).catch(() => {});
  }, [autopilot]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ text: string; bad?: boolean } | null>(null);
  const [run, setRun] = useState<{ version: number; results: Record<string, Status> } | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [channel, setChannel] = useState("global");
  const [editing, setEditing] = useState(false); // while typing in the logic, half-typed references aren't errors yet

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
  const target = draft ?? active ?? versions[0]; // the version a test or publish acts on
  const own = overview?.scenarios.filter((s) => s.procedure === name) ?? [];
  const isNew = own.length === 0; // no scripted scenarios yet: test against all of them, and in Preview
  const scenarios = isNew ? overview?.scenarios ?? [] : own;

  // Every AOP the #picker can offer, with its newest title and purpose.
  const aops = useMemo(() => {
    const byName = new Map<string, { name: string; title: string; goal: string }>();
    for (const v of overview?.versions ?? []) {
      if (!byName.has(v.name) && v.name !== name) byName.set(v.name, { name: v.name, title: v.title ?? aopTitle(v.name), goal: splitAop(v.body).goal });
    }
    return [...byName.values()];
  }, [overview, name]);

  // When the version changes, load its text and the last test of exactly that text.
  useEffect(() => {
    if (creating || !target) return;
    const { goal, logic } = splitAop(target.body);
    setForm({ title: target.title ?? aopTitle(name), goal, logic, note: draft?.note ?? "" });
    setRun(null);
    if (target.latest_run) {
      api.runGet(target.latest_run).then(({ run: r, results }) => {
        if (new Date(r.created_at) < new Date(target.created_at)) return;
        setRun({ version: target.version, results: Object.fromEntries(results.map((x) => [x.scenario_id, x])) });
      }).catch(() => {});
    }
  }, [target?.version, target?.created_at, target?.published_at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="empty error">{error}</div>;
  if (!overview) return <div className="empty muted">Loading…</div>;
  if (!creating && !target) return <div className="empty">There's no AOP called {name}. <a href="#/build/aops">Back to AOPs</a></div>;

  const allTools = overview.tools;
  const current = CHANNELS.find((c) => c.id === channel)!;
  const body = joinAop(form.goal, form.logic);
  const refs = toolRefs(body);
  const unknownTools = refs.filter((t) => !allTools.some((x) => x.name === t));
  const unknownAops = aopRefs(body).filter((a) => !aops.some((x) => x.name === a));
  const unknownMeta = metaRefs(body).filter((k) => !overview.metadata.some((m) => m.key === k));
  const unknown = [...unknownTools.map((t) => `@${t}`), ...unknownAops.map((a) => `#${a}`), ...unknownMeta.map((k) => `{{ ${k} }}`)];
  const changed = creating || !target || body !== target.body || form.title !== (target.title ?? aopTitle(name));
  const dirty = changed || (!!draft && form.note !== draft.note);
  const results = run && target && run.version === target.version ? run.results : null;
  const finished = results ? Object.values(results).filter((r): r is SimResult => typeof r === "object") : [];
  const gated = scenarios.filter((s) => s.gate);
  const allPassed = !!results && gated.every((s) => {
    const r = results[s.id];
    return typeof r === "object" && r.passed;
  });
  const tried = !!draft?.tried_in_preview;
  const canPublish = !!draft && !dirty && allPassed && (!isNew || tried) && busy === "";

  function edit(patch: Partial<Form>) {
    setForm((f) => ({ ...f, ...patch }));
    setMessage(null);
  }

  async function act(label: string, fn: () => Promise<string | void>) {
    setBusy(label);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ text });
    } catch (e) {
      setMessage({ text: (e as Error).message, bad: true });
    } finally {
      setBusy("");
    }
  }

  const save = () => act("save", async () => {
    if (!form.title.trim()) throw new Error("Give the AOP a name.");
    if (!form.goal.trim()) throw new Error("Say what this AOP is used for. The agent reads it to decide when to use the AOP.");
    if (creating) {
      const saved = await api.createAop({ name: aopId(form.title), title: form.title, body, note: form.note });
      go(`#/build/aops/${saved.name}`);
      return;
    }
    const saved = await api.saveDraft({ name, title: form.title, body, note: form.note });
    await load();
    return `Saved as draft v${saved.version}. Customers keep ${active ? `v${active.version}` : "the live AOPs"} until you publish. Next: run the simulations.`;
  });

  const discard = () => {
    if (!draft || !window.confirm(`Discard draft v${draft.version}? This can't be undone.`)) return;
    void act("discard", async () => {
      await api.discardDraft(name, draft.version);
      if (versions.length === 1) return go("#/build/aops");
      await load();
      return `Discarded draft v${draft.version}.`;
    });
  };

  const runSimulations = () => act("test", async () => {
    if (!target) return;
    const { run_id, scenarios: ids } = await api.runStart(name, target.version);
    setRun({ version: target.version, results: Object.fromEntries(ids.map((id) => [id, "waiting" as Status])) });
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
  });

  const publish = () => act("publish", async () => {
    if (!draft) return;
    const { previous } = await api.publish(name, draft.version);
    await load();
    return `v${draft.version} is live${previous ? `, replacing v${previous}` : ""}. Every chat from now on uses it.`;
  });

  const rollback = (v: Version) => act(`rollback-${v.version}`, async () => {
    const { previous } = await api.rollback(name, v.version);
    await load();
    return `Rolled back to v${v.version}${previous ? ` from v${previous}` : ""}.`;
  });

  const retire = () => {
    if (!active || !window.confirm(`Take ${form.title} out of the agent? Customers stop getting it right away.`)) return;
    void act("retire", async () => {
      await api.retire(name);
      await load();
      return `${form.title} is retired. Publish or roll back to bring it back.`;
    });
  };

  const titleBefore = active?.title ?? aopTitle(name);
  const showDiff = !!active && !creating && (body !== active.body || form.title !== titleBefore);

  return (
    <div className="page">
      <div className="crumb"><a href="#/build/aops">AOPs</a><Icon name="chevron" size={12} /><span>{creating ? "New AOP" : form.title}</span></div>
      <div className="page-head">
        <input className="title-input" value={form.title} placeholder="Name this AOP" maxLength={60} aria-label="AOP name" onChange={(e) => edit({ title: e.target.value })} />
        {!creating && (
          <div className="row">
            {active ? <span className="pill ok">Live v{active.version}</span> : !draft && <span className="pill">Not live</span>}
            {draft && <span className="pill draft">Draft v{draft.version}</span>}
          </div>
        )}
        <span className="spacer" />
        {!creating && target && (
          <button className="secondary" disabled={dirty} title={dirty ? "Save first" : undefined}
            onClick={() => go(draft ? `#/preview?aop=${name}&v=${draft.version}` : "#/preview")}>
            <Icon name="preview" size={14} />Try in Preview
          </button>
        )}
        <button className="primary" disabled={busy !== "" || (draft ? !dirty : !changed)} onClick={save}>
          {busy === "save" ? "Saving…" : creating ? "Create draft" : "Save draft"}
        </button>
      </div>
      {creating && form.title.trim() && <div className="muted small" style={{ marginTop: -12 }}>ID <span className="mono">{aopId(form.title)}</span></div>}
      {message && <div className={`notice${message.bad ? " bad" : ""}`}>{message.text}</div>}

      <div className="aop-layout">
        <div className="aop-col">
          {autopilot && <AutopilotBanner suggestion={autopilot} usage={usage} />}
          <div className="card">
            <h2>What is this AOP used for?</h2>
            <p className="muted small">The agent reads this to decide when to use the AOP.</p>
            <textarea className="text-area" rows={2} value={form.goal} placeholder="Use this AOP when a customer…" aria-label="What this AOP is used for" onChange={(e) => edit({ goal: e.target.value })} />
          </div>

          <div className="card">
            <div className="card-head">
              <Icon name="link" />
              <h2>AOP Logic</h2>
              <span className="spacer" />
              <div className="channel" onMouseLeave={() => setChannelOpen(false)}>
                <button className="channel-btn" aria-expanded={channelOpen} onClick={() => setChannelOpen((o) => !o)}>
                  <Icon name={current.icon} />{current.label}<Icon name="down" size={14} />
                </button>
                {channelOpen && (
                  <div className="channel-menu" role="menu">
                    {CHANNELS.map((c) => (
                      <button key={c.id} role="menuitemradio" aria-checked={c.id === channel} className={c.id === channel ? "on" : ""}
                        onClick={() => {
                          setChannel(c.id);
                          setChannelOpen(false);
                        }}>
                        <Icon name={c.icon} />{c.label}<span className="hint">{c.hint}</span>
                      </button>
                    ))}
                    <hr />
                    <button disabled title="Channel variants aren't part of this POC"><Icon name="plus" />Add variant</button>
                  </div>
                )}
              </div>
            </div>
            <div className="banner" style={{ marginBottom: 12 }}>
              <span className="info-dot">i</span>
              <span>
                Use <b className="ref-tool">@</b> to reference specific tools and <b className="ref-aop">#</b> to reference other AOPs.
                Use <b className="ref-meta">{"{{ metadata }}"}</b> to reference customer metadata, such as <span className="mono">{"{{ customer.is_new }}"}</span>.
                Written once, this AOP works the same on every channel.
              </span>
            </div>
            {current.id !== "global" && (
              <div className="notice" style={{ marginBottom: 12 }}>
                <b>{current.label}</b> uses the Global logic below, since it has no variant of its own. {current.note}
              </div>
            )}
            <div onFocus={() => setEditing(true)} onBlur={() => setEditing(false)}>
              <AopEditor value={form.logic} onChange={(logic) => edit({ logic })} tools={allTools} aops={aops} metadata={overview.metadata} />
            </div>
            <div className="uses" style={{ marginTop: 12 }}>
              <span className="muted">Can call</span>
              {refs.filter((t) => allTools.some((x) => x.name === t && !x.always_on)).map((t) => <span key={t} className="mono ref-tool">@{t}</span>)}
              {!refs.some((t) => allTools.some((x) => x.name === t && !x.always_on)) && <span className="muted">no tools yet</span>}
              <span className="muted">· always on:</span>
              {allTools.filter((t) => t.always_on).map((t) => <span key={t.name} className="mono muted">{t.name}</span>)}
            </div>
            {!editing && unknown.length > 0 && (
              <div className="notice bad" style={{ marginTop: 10 }}>
                {unknown.join(", ")} {unknown.length > 1 ? "don't" : "doesn't"} exist. Type @, # or {"{{"} to pick from the list.
              </div>
            )}
          </div>

          <button className="advanced-toggle" onClick={() => setAdvanced((a) => !a)}>Advanced Settings {advanced ? "↑" : "↓"}</button>
          {advanced && (
            <div className="card">
              <div className="setting">
                <div className="what"><b>AOP visibility</b><div className="muted small">Limit this AOP to some customers, by their metadata.</div></div>
                <select className="select" disabled><option>All customers</option></select>
              </div>
              <div className="setting">
                <div className="what"><b>Force AOP selection</b><div className="muted small">Always use this AOP when it matches, instead of letting the agent choose. Use with care.</div></div>
                <button className="switch" disabled aria-label="Force AOP selection: off" />
              </div>
              <div className="setting">
                <div className="what"><b>Change note</b><div className="muted small">Shown in Versioning with the draft.</div></div>
                <input className="text-input" style={{ maxWidth: 320 }} value={form.note} maxLength={200} placeholder="What changed" onChange={(e) => edit({ note: e.target.value })} />
              </div>
              {(draft || active) && (
                <div className="setting">
                  <div className="what"><b>Remove</b><div className="muted small">Discard the open draft, or retire the AOP so the agent stops using it.</div></div>
                  <div className="row">
                    {draft && <button className="secondary" disabled={busy !== ""} onClick={discard}>Discard draft</button>}
                    {active && <button className="secondary" disabled={busy !== ""} onClick={retire}>Retire AOP</button>}
                  </div>
                </div>
              )}
            </div>
          )}

          {showDiff && (
            <div className="card">
              <h2>Changes from live v{active!.version}</h2>
              <div className="diff">
                {form.title !== titleBefore && <div className="diff-line add">Name: {form.title}</div>}
                {diffLines(active!.body, body).filter((l) => l.kind !== "same").map((l, i) => (
                  <div key={i} className={`diff-line ${l.kind}`}>{l.kind === "add" ? "+ " : "− "}{l.text}</div>
                ))}
              </div>
            </div>
          )}

          {!creating && target && (
            <div className="card">
              <div className="card-head">
                <h2>Simulations on v{target.version}</h2>
                {results && <span className="tally muted"><span className="big" style={{ color: "var(--ink)" }}>{finished.filter((r) => r.passed).length}/{scenarios.length}</span>passed</span>}
                <span className="spacer" />
                <button className="secondary" disabled={busy !== "" || dirty} onClick={runSimulations}>
                  {busy === "test" ? "Running…" : results ? "Run again" : `Run ${scenarios.length} simulations`}
                </button>
              </div>
              <p className="muted small">
                {isNew
                  ? "No scripted conversations cover this AOP yet. Adding it changes what the agent can pick, so this plays every existing one with it added, to show the other AOPs still behave. Then try it in Preview."
                  : "Scripted customer conversations played against this exact version, then checked against the trace and the database."}
                {dirty && " Save first, so the simulations test what you see."}
              </p>
              <div className="scenario-list">
                {scenarios.map((s) => {
                  const r = results?.[s.id];
                  const state = !r ? "idle" : typeof r === "string" ? r : r.passed ? "pass" : "fail";
                  return (
                    <div key={s.id} className="scenario">
                      <div className="scenario-top">
                        <span className={`dot ${state}`} />
                        <span className="scenario-name">{SCENARIO_NAMES[s.id] ?? s.id}</span>
                        {!s.gate && <span className="pill">stat</span>}
                        <span className="muted small">{state === "running" ? "running…" : state === "waiting" ? "queued" : typeof r === "object" ? `${r.outcome} · ${(r.ms / 1000).toFixed(1)}s` : ""}</span>
                        {typeof r === "object" && r.conversation_id && <button className="link small" onClick={() => setLogId(r.conversation_id)}>Log</button>}
                      </div>
                      <div className="turns">{s.turns.map((t, i) => <span key={i} className="turn">“{t}”</span>)}</div>
                      {typeof r === "object" && r.failures.length > 0 && <ul className="failures">{r.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="side-col">
          {!creating && (
            <div className="card">
              <h2>Publish</h2>
              {draft ? (
                <>
                  <ul className="gate">
                    <li className={!dirty ? "ok" : ""}>Draft v{draft.version} saved</li>
                    <li className={allPassed ? "ok" : ""}>Every gated simulation passed ({gated.length})</li>
                    {isNew && <li className={tried ? "ok" : ""}>Tried in Preview: the agent picked v{draft.version} in a chat</li>}
                  </ul>
                  <button className="primary" style={{ width: "100%", justifyContent: "center" }} disabled={!canPublish} onClick={publish}>
                    {busy === "publish" ? "Publishing…" : `Publish v${draft.version}`}
                  </button>
                  <p className="muted small" style={{ margin: "10px 0 0" }}>
                    {active ? `v${active.version} stays one click away in Versions.` : "The agent can pick it from the next message."}
                  </p>
                </>
              ) : (
                <p className="muted small" style={{ margin: 0 }}>Edit and save a draft to publish a new version.</p>
              )}
            </div>
          )}
          {!creating && (
            <div className="card">
              <h2>Versions</h2>
              <div className="versions">
                {versions.map((v) => (
                  <div key={v.version} className={`version${v.version === target?.version ? " current" : ""}`}>
                    <div className="row">
                      <span className="mono">v{v.version}</span>
                      {v.is_active ? <span className="pill ok">Live</span> : v.published_at ? <span className="pill">Published</span> : <span className="pill draft">Draft</span>}
                    </div>
                    <div className="muted small">{v.author ?? "Bookly CX"} · {ago(v.published_at ?? v.created_at)}</div>
                    {v.note && <div className="small">{v.note}</div>}
                    {v.published_at && !v.is_active && (
                      <button className="link small" style={{ alignSelf: "flex-start" }} disabled={busy !== ""} onClick={() => rollback(v)}>
                        {busy === `rollback-${v.version}` ? "Rolling back…" : active ? "Roll back to this version" : "Make this version live"}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {creating && (
            <div className="card">
              <h2>How a new AOP goes live</h2>
              <ol className="muted small" style={{ paddingLeft: 18, margin: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                <li>Create it as a draft. Customers don't see drafts.</li>
                <li>Run the simulations: every existing conversation must still pass with it added.</li>
                <li>Try it in Preview as a customer.</li>
                <li>Publish. Every change lands in Versioning.</li>
              </ol>
            </div>
          )}
        </div>
      </div>
      {logId && <ConversationLog id={logId} onClose={() => setLogId(null)} />}
    </div>
  );
}

// Why Autopilot suggested this AOP: the chats behind it, from the last 30 days, and what's left to write.
function AutopilotBanner({ suggestion, usage }: { suggestion: (typeof SUGGESTIONS)[number]; usage: WatchtowerSummary | null }) {
  const e = usage ? evidence(usage, suggestion) : null;
  return (
    <div className="card autopilot-card">
      <div className="row">
        <span className="tag"><Icon name="autopilot" size={12} />Optimization</span>
        <span className="tag">AOP</span>
        <span className="muted small">Suggested by Autopilot from your last {e?.days ?? 30} days of chats</span>
      </div>
      <h2 style={{ margin: "8px 0 6px" }}>{suggestion.title}</h2>
      {!e ? <p className="muted small">Loading the data behind this suggestion…</p> : (
        <div className="evidence">
          <div><b>{e.count}</b><span>{suggestion.category.toLowerCase()} chats</span></div>
          <div><b>{e.handed}</b><span>reached a person ({100 - e.deflection}%){e.lowest ? ", the lowest deflection of any topic" : ""}</span></div>
          {e.watchtower && <div><b>{e.watchtower.count}</b><span>caught by the “{e.watchtower.name}” watchtower</span></div>}
          <div><b className="gain">+{e.gain}</b><span>contained conversations a week if half stay with the agent</span></div>
        </div>
      )}
      <div className="row" style={{ marginTop: 10, flexWrap: "wrap" }}>
        <span className="finish">{suggestion.draft!.finish}</span>
        {suggestion.watchtower && <a className="link small" href={`#/analyze/watchtowers?tower=${suggestion.watchtower}`}>See the conversations</a>}
      </div>
    </div>
  );
}
