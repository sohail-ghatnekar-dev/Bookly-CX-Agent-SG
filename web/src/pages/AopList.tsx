// Build › AOPs: every Agent Operating Procedure, what it's for, what's live, and the tools and AOPs it references.
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../components/Icon";
import { api, type Overview, type Version } from "../lib/api";
import { ago, aopTitle, sentence, splitAop } from "../lib/format";
import { aopRefs, toolRefs } from "../lib/refs";
import { go } from "../lib/router";

export function AopListPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.overview().then(setOverview).catch((e: Error) => setError(e.message));
  }, []);

  // One row per AOP: the live version, or the newest one if nothing is live.
  const rows = useMemo(() => {
    const byName = new Map<string, Version[]>();
    for (const v of overview?.versions ?? []) byName.set(v.name, [...(byName.get(v.name) ?? []), v]);
    return [...byName.entries()].map(([name, vs]) => {
      const live = vs.find((v) => v.is_active);
      const draft = vs.find((v) => !v.published_at);
      const shown = draft ?? live ?? vs[0];
      return { name, title: shown.title ?? aopTitle(name), live, draft, shown };
    }).sort((a, b) => a.title.localeCompare(b.title));
  }, [overview]);

  if (error) return <div className="empty error">{error}</div>;

  return (
    <div className="page">
      <div className="page-head">
        <h1>AOPs</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => go("#/build/aops/new")}><Icon name="plus" size={14} />New AOP</button>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
        Agent Operating Procedures: how the agent handles each kind of request, written in natural language. Reference tools with @ and other AOPs with #.
      </p>
      <div className="card table-card">
        <table className="log">
          <thead>
            <tr><th>AOP</th><th>Status</th><th>Channels</th><th>Tools</th><th>AOPs</th><th>Last change</th></tr>
          </thead>
          <tbody>
            {!overview && <tr><td colSpan={6} className="muted">Loading…</td></tr>}
            {rows.map((r) => (
              <tr key={r.name} className="clickable" onClick={() => go(`#/build/aops/${r.name}`)}>
                <td>
                  <div className="aop-name">{r.title}</div>
                  <div className="muted small">{sentence(splitAop(r.shown.body).goal)}</div>
                </td>
                <td>
                  <div className="row">
                    {r.live ? <span className="pill ok">Live v{r.live.version}</span> : !r.draft && <span className="pill">Not live</span>}
                    {r.draft && <span className="pill draft">Draft v{r.draft.version}</span>}
                  </div>
                </td>
                <td><span className="row muted"><Icon name="globe" size={14} />Global</span></td>
                <td><div className="ref-list">{toolRefs(r.shown.body).map((t) => <span key={t} className="mono ref-tool">@{t}</span>)}</div></td>
                <td><div className="ref-list">{aopRefs(r.shown.body).map((a) => <span key={a} className="mono ref-aop">#{a}</span>)}</div></td>
                <td className="muted small">{ago(r.shown.created_at)}<div>{r.shown.author ?? "Bookly CX"}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
