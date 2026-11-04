// Analyze › Insights: the high-level view. What customers are asking, how much of each the agent resolves, when they
// write in, how long chats run, and which policy articles answer them. All, deflected or undeflected chats.
import { useEffect, useMemo, useState } from "react";
import { Donut, HourlyBars, ShareBars } from "../components/Charts";
import { Icon } from "../components/Icon";
import { api, type WatchtowerSummary } from "../lib/api";
import { DONUT, OTHER_SLICE } from "../lib/colors";
import { ago, percent } from "../lib/format";

type View = "all" | "deflected" | "undeflected";
type Measure = "rate" | "volume" | "handoffs";

// Bookly's policy documents (supabase/seed.sql), shown as help-centre paths like the articles they'd be.
const ARTICLES: Record<string, string> = {
  "RET-30": "change-of-mind-returns",
  "RET-60": "damaged-or-defective-items",
  "RET-DIGITAL": "ebooks",
  "RET-NOTDELIVERED": "returns-before-delivery",
  "PAY-1": "refund-timing",
  "SHIP-1": "us-shipping",
  "SHIP-2": "canada-and-uk-shipping",
  "SHIP-3": "dispatch-and-tracking",
  "ACC-1": "password-reset",
  "HELP-1": "support-hours",
};

export function InsightsPage() {
  const [s, setS] = useState<WatchtowerSummary | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<View>("all");
  const [measure, setMeasure] = useState<Measure>("rate");
  const [search, setSearch] = useState("");
  useEffect(() => {
    api.watchtower().then(setS).catch((e: Error) => setError(e.message));
  }, []);

  // Colour follows the category, by its rank across all chats, so switching views never repaints a slice.
  const colors = useMemo(() => {
    const ranked = (s?.categories ?? []).filter((c) => c.name !== "Other");
    return new Map(ranked.map((c, i) => [c.name, i < DONUT.length ? DONUT[i] : OTHER_SLICE]));
  }, [s]);

  if (error) return <div className="empty error">{error}</div>;
  if (!s) return <div className="empty muted">Loading Insights…</div>;

  type Category = WatchtowerSummary["categories"][number];
  const countIn = (c: Category) => (view === "all" ? c.count : view === "deflected" ? c.deflected : c.count - c.deflected);
  const named = s.categories.filter((c) => c.name !== "Other" && colors.get(c.name) !== OTHER_SLICE);
  const folded = s.categories.filter((c) => !named.includes(c)).reduce((a, c) => a + countIn(c), 0);
  const slices = [
    ...named.map((c) => ({ name: c.name, count: countIn(c), color: colors.get(c.name) })).filter((x) => x.count > 0),
    ...(folded > 0 ? [{ name: "Other", count: folded, color: OTHER_SLICE }] : []),
  ];

  const value = (c: Category) => (measure === "rate" ? c.deflected / Math.max(c.count, 1) : measure === "volume" ? c.count : c.count - c.deflected);
  const ranked = [...s.categories].sort((a, b) => value(b) - value(a));
  const top = Math.max(...ranked.map(value), 1e-9);

  const articles = s.articles.filter((a) => `${a.key} ${ARTICLES[a.key] ?? ""}`.toLowerCase().includes(search.toLowerCase()));
  const mostCited = Math.max(1, ...s.articles.map((a) => a.count));
  const messages = s.messages_per_chat.map((count, i) => ({ label: i === 9 ? "10+" : String(i + 1), count }));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Insights</h1>
        <span className="sub">{s.conversations.toLocaleString()} live chats · last {s.days} days · {percent(s.handled_by_agent, s.conversations)} deflected</span>
      </div>
      <div className="segmented wide" role="tablist">
        {(["all", "deflected", "undeflected"] as View[]).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? "active" : ""} onClick={() => setView(v)}>
            {v === "all" ? "All conversations" : v === "deflected" ? "Deflected" : "Undeflected"}
          </button>
        ))}
      </div>

      <div className="card">
        <h2>What are customers asking?</h2>
        <p className="muted small">AI-labeled categories, from the AOP the agent picked and what happened in each chat. Hover a category for its count.</p>
        <Donut slices={slices} />
      </div>

      <div className="card">
        <div className="card-head">
          <h2>What's my deflection rate?</h2>
          <span className="spacer" />
          <select className="select" value={measure} onChange={(e) => setMeasure(e.target.value as Measure)} aria-label="Measure">
            <option value="rate">Deflection rate</option>
            <option value="volume">Conversations</option>
            <option value="handoffs">Handed to an employee</option>
          </select>
        </div>
        {ranked.map((c) => (
          <div key={c.name} className="bar">
            <div className="bar-top">
              <span className="row"><i className="swatch" style={{ background: colors.get(c.name) ?? OTHER_SLICE }} />{c.name}</span>
              <span className="mono muted">{measure === "rate" ? `${percent(c.deflected, c.count)} of ${c.count}` : value(c).toLocaleString()}</span>
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${(value(c) / top) * 100}%` }} /></div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 20, margin: "8px 0 0" }}>Detailed metrics</h2>
      <div className="detail-grid">
        <div className="card">
          <h2>Hourly volume breakdown</h2>
          <p className="muted small">When customers start a chat, over the last {s.days} days</p>
          <HourlyBars counts={s.hourly} />
        </div>
        <div className="card">
          <h2>Customer messages</h2>
          <p className="muted small">Number of customer messages per conversation</p>
          <ShareBars rows={messages} />
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Articles referenced</h2>
          <p className="muted small">The policy articles the agent cited most</p>
          <label className="search"><Icon name="search" /><input placeholder="Search articles" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <div className="articles">
            {articles.map((a) => (
              <div key={a.key} className="article">
                <span className="article-bar" style={{ ["--w" as string]: `${(a.count / mostCited) * 100}%` }}>
                  <span className="mono">/help/policies/{a.key}-{ARTICLES[a.key] ?? "article"}</span>
                </span>
                <span className="mono">{a.count}</span>
              </div>
            ))}
            {articles.length === 0 && <p className="muted small">No articles match.</p>}
          </div>
        </div>
        <div className="card">
          <h2>Why chats reach a person</h2>
          <p className="muted small">The reasons the agent gave when it handed off, most recent first</p>
          {s.recent_handoffs.map((h, i) => (
            <div key={i} className="row-between small" style={{ padding: "7px 0", borderTop: i ? "1px solid var(--line)" : undefined }}>
              <span>{h.reason}</span><span className="muted">{ago(h.at)}</span>
            </div>
          ))}
          <div className="row" style={{ flexWrap: "wrap", gap: 14, marginTop: 12 }}>
            {s.rules_enforced.map((r) => <span key={r.key} className="small"><span className="mono">{r.key}</span> <span className="muted">denied {r.count}×</span></span>)}
          </div>
          <a className="link small" href="#/analyze/watchtowers" style={{ display: "inline-block", marginTop: 10 }}>See what's going wrong in Watchtowers →</a>
        </div>
      </div>
    </div>
  );
}
