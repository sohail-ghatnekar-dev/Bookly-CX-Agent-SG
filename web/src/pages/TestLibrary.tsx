// Test › Test library: every test, grouped by the pathway it covers. Pick a test to see the conversation and each
// checkpoint the evaluation model scored, and click a checkpoint for its rationale. Demo data: Run all and Generate
// tests only animate, and nothing here calls the agent.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { CHECK_KINDS, GENERATED, GROUPS, SOURCES, type CheckKind, type LibraryTest, type TestGroup } from "../lib/testLibrary";

const passed = (t: LibraryTest) => t.checks.every((c) => c.passed);

export function TestLibraryPage() {
  const [generated, setGenerated] = useState(false);
  const [generating, setGenerating] = useState(false);
  const groups = useMemo(() => (generated ? [GENERATED, ...GROUPS] : GROUPS), [generated]);
  const all = useMemo(() => groups.flatMap((g) => g.tests), [groups]);

  const [selected, setSelected] = useState(GROUPS[0].tests[0].id);
  const [open, setOpen] = useState<Record<string, boolean>>({ [GROUPS[0].key]: true });
  const [query, setQuery] = useState("");
  const [failingOnly, setFailingOnly] = useState(false);
  const [kind, setKind] = useState<CheckKind | null>(null);
  const [progress, setProgress] = useState<number | null>(null); // Run all: how many tests have finished
  const [ranAt, setRanAt] = useState("2 hours ago");

  // Run all: tests finish a few at a time, in list order.
  useEffect(() => {
    if (progress === null) return;
    if (progress >= all.length) {
      setProgress(null);
      setRanAt("just now");
      return;
    }
    const id = setTimeout(() => setProgress((p) => (p ?? 0) + 2), 70);
    return () => clearTimeout(id);
  }, [progress, all.length]);

  function generate() {
    setGenerating(true);
    setTimeout(() => {
      setGenerating(false);
      setGenerated(true);
      setOpen((o) => ({ ...o, [GENERATED.key]: true }));
      setSelected(GENERATED.tests[0].id);
    }, 1800);
  }

  const q = query.trim().toLowerCase();
  const shown = (t: LibraryTest) =>
    (!failingOnly || !passed(t)) &&
    (!kind || t.checks.some((c) => c.kind === kind)) &&
    (!q || t.name.toLowerCase().includes(q) || t.turns.some((x) => x.toLowerCase().includes(q)));
  const filtering = failingOnly || !!kind || !!q;

  const index = new Map(all.map((t, i) => [t.id, i]));
  const stateOf = (t: LibraryTest): "pass" | "fail" | "running" | "waiting" => {
    const i = index.get(t.id)!;
    if (progress !== null && i >= progress) return i < progress + 4 ? "running" : "waiting";
    return passed(t) ? "pass" : "fail";
  };

  const passing = all.filter(passed).length;
  const checkpoints = all.reduce((n, t) => n + t.checks.length, 0);
  const test = all.find((t) => t.id === selected) ?? all[0];
  const group = groups.find((g) => g.tests.includes(test))!;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Test library</h1>
        <span className="spacer" />
        <button className="secondary" disabled={generating || generated} onClick={generate}>
          <Icon name="autopilot" size={15} />{generating ? "Generating from chats…" : generated ? "4 tests generated" : "Generate tests"}
        </button>
        <button className="primary" disabled={progress !== null} onClick={() => setProgress(0)}>
          <Icon name="play" size={14} />{progress !== null ? `Running ${Math.min(progress, all.length)}/${all.length}…` : `Run all ${all.length}`}
        </button>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 860 }}>
        Tests across every pathway customers take, generated from real chats or written by the team. Each one checks that the agent picks
        the right AOP, calls the right tools, sounds like Bookly, stays inside policy, and hands off when it should.
      </p>

      <div className="stats lib-stats">
        <div className="stat"><div className="stat-value">{all.length}</div><div className="stat-label">Tests</div></div>
        <div className="stat"><div className="stat-value">{groups.length}</div><div className="stat-label">Pathways covered</div></div>
        <div className="stat"><div className="stat-value">{passing}<span className="lib-of">/{all.length}</span></div><div className="stat-label">Passing · last run {ranAt}</div></div>
        <div className="stat"><div className="stat-value">{checkpoints}</div><div className="stat-label">Checkpoints scored</div></div>
      </div>

      <div className="lib-kinds" role="group" aria-label="Filter by checkpoint">
        {CHECK_KINDS.map((k) => {
          const scored = all.flatMap((t) => t.checks.filter((c) => c.kind === k.kind));
          const ok = scored.filter((c) => c.passed).length;
          return (
            <button key={k.kind} className={`lib-kind${kind === k.kind ? " on" : ""}`} aria-pressed={kind === k.kind} onClick={() => setKind(kind === k.kind ? null : k.kind)}>
              <span className="lib-kind-title">{k.title}</span>
              <span className="lib-kind-bar"><span style={{ width: `${(ok / scored.length) * 100}%` }} /></span>
              <span className="muted small">{ok}/{scored.length} passed</span>
            </button>
          );
        })}
      </div>

      <div className="lib-cols">
        <div className="lib-list">
          <div className="row" style={{ gap: 10 }}>
            <label className="search" style={{ flex: 1 }}>
              <Icon name="search" size={15} />
              <input value={query} placeholder="Search tests and conversations" onChange={(e) => setQuery(e.target.value)} aria-label="Search tests" />
            </label>
            <div className="segmented" role="group" aria-label="Status">
              <button className={!failingOnly ? "active" : ""} onClick={() => setFailingOnly(false)}>All</button>
              <button className={failingOnly ? "active" : ""} onClick={() => setFailingOnly(true)}>Failing · {all.length - passing}</button>
            </div>
          </div>
          {groups.map((g) => (
            <Group key={g.key} group={g} isNew={g === GENERATED} open={filtering || !!open[g.key]} toggle={() => setOpen((o) => ({ ...o, [g.key]: !o[g.key] }))}
              tests={g.tests.filter(shown)} selected={test.id} onSelect={setSelected} stateOf={stateOf} />
          ))}
          {filtering && !all.some(shown) && <div className="card muted">No tests match.</div>}
        </div>
        <TestDetail key={test.id} test={test} group={group} state={stateOf(test)} />
      </div>
    </div>
  );
}

function Group({ group, isNew, open, toggle, tests, selected, onSelect, stateOf }: {
  group: TestGroup;
  isNew: boolean;
  open: boolean;
  toggle: () => void;
  tests: LibraryTest[];
  selected: string;
  onSelect: (id: string) => void;
  stateOf: (t: LibraryTest) => string;
}) {
  if (!tests.length) return null;
  const ok = group.tests.filter(passed).length;
  return (
    <div className="card lib-group">
      <button className="lib-group-head" aria-expanded={open} onClick={toggle}>
        <span className={`chev${open ? " open" : ""}`}><Icon name="chevron" size={14} /></span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="lib-group-title">{group.title}{isNew && <span className="pill info">New</span>}</span>
          <span className="muted small lib-about">{group.about}</span>
        </span>
        <span className={`pill ${ok === group.tests.length ? "ok" : "bad"}`}>{ok}/{group.tests.length}</span>
      </button>
      {open && (
        <ul className="lib-tests">
          {tests.map((t) => (
            <li key={t.id}>
              <button className={`lib-test${t.id === selected ? " on" : ""}`} onClick={() => onSelect(t.id)}>
                <span className={`dot ${stateOf(t)}`} />
                <span className="lib-test-name">{t.name}</span>
                <span className="lib-marks" aria-label={`${t.checks.filter((c) => c.passed).length} of ${t.checks.length} checkpoints passed`}>
                  {t.checks.map((c, i) => <span key={i} className={c.passed ? "ok" : "bad"} />)}
                </span>
                <span className="muted small lib-source">{SOURCES[t.source]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TestDetail({ test, group, state }: { test: LibraryTest; group: TestGroup; state: string }) {
  const [shown, setShown] = useState<Set<number>>(() => new Set(test.checks.map((c, i) => (c.passed ? -1 : i)).filter((i) => i >= 0)));
  const toggle = (i: number) => setShown((s) => {
    const next = new Set(s);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });
  const done = state === "pass" || state === "fail";

  return (
    <aside className="card lib-detail">
      <div className="scenario-top">
        <span className={`dot ${state}`} />
        <h2 style={{ margin: 0, flex: 1 }}>{test.name}</h2>
        {done && <span className={`pill ${state === "pass" ? "ok" : "bad"}`}>{state === "pass" ? "Passed" : "Failed"}</span>}
        {!done && <span className="muted small">{state === "running" ? "running…" : "queued"}</span>}
      </div>
      <div className="muted small row" style={{ flexWrap: "wrap", gap: 6 }}>
        <span>{group.title}</span>·<a className="chip chip-ref mono" href={`#/build/aops/${test.aop}`}>#{test.aop}</a>·<span>{SOURCES[test.source]}</span>·<span>{(test.ms / 1000).toFixed(1)}s</span>
      </div>

      <div className="lib-panes">
        <div className="lib-convo">
          <div className="eyebrow">Conversation</div>
          <div className="mini-chat">
            {test.turns.map((turn, i) => {
              const m = /^\[(voice|email|assist)\] /.exec(turn);
              return (
                <div key={i} className={`mini-bubble ${i % 2 ? "agent" : "user"}`}>
                  {m && <span className="lib-channel">{m[1] === "assist" ? "Agent Assist" : m[1]}</span>}
                  {m ? turn.slice(m[0].length) : turn}
                </div>
              );
            })}
          </div>
        </div>

        <div className="lib-conducted">
          <span className="lib-badge">Tests conducted</span>
          <ul>
            {test.checks.map((c, i) => {
              const k = CHECK_KINDS.find((x) => x.kind === c.kind)!;
              return (
                <li key={i} className={!done ? "" : c.passed ? "ok" : "bad"}>
                  <button className="lib-check" aria-expanded={shown.has(i)} onClick={() => toggle(i)} title="Click for the evaluation model's rationale">
                    <span className="lib-box" aria-hidden="true" />
                    <span>
                      <span className="lib-check-title">{k.title}</span>
                      <span className="muted small">{c.detail}</span>
                    </span>
                  </button>
                  {shown.has(i) && done && (
                    <div className="lib-why">
                      <span className="eyebrow">Evaluation rationale</span>
                      {c.why}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="muted small" style={{ marginTop: 10 }}>Click a checkpoint to see why it passed or failed.</div>
        </div>
      </div>
    </aside>
  );
}
