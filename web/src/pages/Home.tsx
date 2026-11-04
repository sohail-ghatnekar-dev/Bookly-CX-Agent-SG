// Home: what Autopilot suggests next, then the metrics at a glance. Volume, deflection, cost savings and CSAT
// over the last 30 days of live chats, daily or weekly.
import { useEffect, useMemo, useState } from "react";
import { RatingBars, Stat, TimeChart } from "../components/Charts";
import { VOLUME } from "../lib/colors";
import { Icon } from "../components/Icon";
import { api, type WatchtowerSummary } from "../lib/api";
import { percent } from "../lib/format";
import { go } from "../lib/router";

// What a chat handled by a person costs Bookly, so each chat the agent resolves saves about this much.
const COST_PER_HUMAN_CHAT = 5.4;

// Autopilot's suggestions: the topics where the most chats still reach a person, and what would change.
const SUGGESTIONS: Record<string, { title: string; aop: string }> = {
  "Late delivery": { title: "Order status: give a carrier update and a new date before handing off", aop: "order_status" },
  "Change-of-mind return": { title: "Returns: explain the 30-day window before checking eligibility", aop: "returns" },
  "Damaged or defective item": { title: "New AOP: damaged items, with the 60-day window and a photo", aop: "new" },
  "Ebook return": { title: "Returns: explain ebook rules and offer a format exchange", aop: "returns" },
  Other: { title: "New AOP: address changes, gift cards and pre-orders", aop: "new" },
  "Account and password": { title: "Policy questions: walk through the password reset step by step", aop: "policy_qa" },
};

type Row = { date: string; total: number; deflected: number; csat: number | null };
// A day with fewer chats than this (like today, just started) is too small to plot as a rate.
const MIN_FOR_RATE = 5;

// Seven-day buckets ending today, for the weekly view.
function weekly(days: Row[]): Row[] {
  const out: Row[] = [];
  for (let end = days.length; end > 0; end -= 7) {
    const week = days.slice(Math.max(0, end - 7), end);
    const rated = week.filter((d) => d.csat !== null);
    out.unshift({
      date: week[0].date,
      total: week.reduce((a, d) => a + d.total, 0),
      deflected: week.reduce((a, d) => a + d.deflected, 0),
      csat: rated.length ? Math.round((rated.reduce((a, d) => a + d.csat! * d.total, 0) / rated.reduce((a, d) => a + d.total, 0)) * 10) / 10 : null,
    });
  }
  return out;
}

export function HomePage() {
  const [s, setS] = useState<WatchtowerSummary | null>(null);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState<"daily" | "weekly">("daily");
  useEffect(() => {
    api.watchtower().then(setS).catch((e: Error) => setError(e.message));
  }, []);

  const rows = useMemo(() => (s ? (period === "daily" ? s.daily : weekly(s.daily)) : []), [s, period]);

  if (error) return <div className="empty error">{error}</div>;
  if (!s) return <div className="empty muted">Loading…</div>;

  const perWeek = (n: number) => Math.round((n / s.days) * 7);
  const suggestions = s.categories
    .filter((c) => SUGGESTIONS[c.name] && c.count > c.deflected)
    .sort((a, b) => (b.count - b.deflected) - (a.count - a.deflected))
    .slice(0, 3);
  const dates = rows.map((r) => r.date);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Home</h1>
        <span className="spacer" />
        <button className="ghost" onClick={() => go("#/build/aops/new")}><Icon name="plus" size={14} />New intent</button>
      </div>

      <div className="section-title"><Icon name="autopilot" />Autopilot suggestions</div>
      <div className="suggestions">
        {suggestions.map((c) => {
          const idea = SUGGESTIONS[c.name];
          const handed = c.count - c.deflected;
          return (
            <button key={c.name} className="suggestion" onClick={() => go(`#/build/aops/${idea.aop}`)}>
              <div className="row"><span className="tag"><Icon name="autopilot" size={12} />Optimization</span><span className="tag">AOP</span></div>
              <h3>{idea.title}</h3>
              <span className="muted small">{handed} of {c.count} {c.name.toLowerCase()} chats reached a person in the last {s.days} days.</span>
              <div className="foot">
                <span className="row"><Icon name="conversations" size={14} />{perWeek(c.count)} convos/wk</span>
                <span className="gain">↗ +{Math.max(1, Math.round(perWeek(handed) * 0.5))} contained conversations per week</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="row-between">
        <div className="section-title"><Icon name="analyze" />Metrics</div>
        <div className="row">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={period === "daily"} className={period === "daily" ? "active" : ""} onClick={() => setPeriod("daily")}>Daily</button>
            <button role="tab" aria-selected={period === "weekly"} className={period === "weekly" ? "active" : ""} onClick={() => setPeriod("weekly")}>Weekly</button>
          </div>
          <button className="secondary" disabled title="Filters aren't part of this demo">Add filters</button>
        </div>
      </div>

      <div className="home-grid">
        <div className="card">
          <h2>At a glance</h2>
          <p className="muted small">Live chats over the last {s.days} days</p>
          <div className="glance">
            <Stat value={s.conversations.toLocaleString()} label="Total conversations" />
            <Stat value={percent(s.handled_by_agent, s.conversations)} label="Deflection rate" hint="Chats the agent resolved without handing to a person." />
            <Stat
              value={`$${(s.handled_by_agent * COST_PER_HUMAN_CHAT).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              label="Cost savings"
              hint={`Resolved chats × $${COST_PER_HUMAN_CHAT.toFixed(2)}, the average cost of a chat handled by a person.`}
            />
            <Stat value={s.csat.average?.toFixed(1) ?? "–"} label="CSAT" hint={`Average of ${s.csat.rated} ratings, out of 5.`} />
          </div>
        </div>
        <div className="card">
          <h2>Conversation volume</h2>
          <TimeChart dates={dates} series={[
            { name: "Total", color: VOLUME.total, values: rows.map((r) => r.total), fill: true },
            { name: "Deflected", color: VOLUME.deflected, values: rows.map((r) => r.deflected), fill: true },
          ]} />
        </div>
      </div>

      <div className="home-grid-3">
        <div className="card">
          <h2>Customer satisfaction</h2>
          <p className="muted small">{s.csat.rated} rated chats</p>
          <RatingBars counts={s.csat.counts} />
        </div>
        <div className="card">
          <h2>CSAT trends</h2>
          <TimeChart dates={dates} height={190} min={1} max={5} series={[{ name: "CSAT", color: VOLUME.total, values: rows.map((r) => (r.total >= MIN_FOR_RATE ? r.csat : null)) }]} />
        </div>
        <div className="card">
          <h2>Deflection rate trends</h2>
          <TimeChart dates={dates} height={190} max={100} format={(v) => `${Math.round(v)}%`}
            series={[{ name: "Deflection rate", color: VOLUME.total, fill: true, values: rows.map((r) => (r.total >= MIN_FOR_RATE ? Math.round((r.deflected / r.total) * 1000) / 10 : null)) }]} />
        </div>
      </div>
    </div>
  );
}
