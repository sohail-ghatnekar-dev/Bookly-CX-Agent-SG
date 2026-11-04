// Home: what Autopilot suggests next, then the metrics at a glance. Volume, deflection, cost savings and CSAT
// over the last 30 days of live chats, daily or weekly.
import { useEffect, useMemo, useState } from "react";
import { RatingBars, Stat, TimeChart } from "../components/Charts";
import { VOLUME } from "../lib/colors";
import { Icon } from "../components/Icon";
import { Info } from "../components/Info";
import { api, type WatchtowerSummary } from "../lib/api";
import { evidence, linkFor, topSuggestions } from "../lib/autopilot";
import { percent } from "../lib/format";
import { go } from "../lib/router";

// What a chat handled by a person costs Bookly, so each chat the agent resolves saves about this much.
const COST_PER_HUMAN_CHAT = 5.4;

type Row = { date: string; total: number; deflected: number; csat: number | null };
// A day with fewer chats than this (like today, just started) is too small to plot as a rate.
const MIN_FOR_RATE = 15;

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

  const suggestions = topSuggestions(s);
  const dates = rows.map((r) => r.date);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Home</h1>
        <span className="spacer" />
        <button className="ghost" onClick={() => go("#/build/aops/new")}><Icon name="plus" size={14} />New intent</button>
      </div>

      <div className="section-title">
        <Icon name="autopilot" />Autopilot suggestions
        <Info text={`Autopilot reads the last ${s.days} days of chats and suggests changes where the most chats still reach a person. “Contained conversations” assumes half of those would stay with the agent after the change.`} />
      </div>
      <div className="suggestions">
        {suggestions.map((sug) => {
          const e = evidence(s, sug)!;
          return (
            <button key={sug.key} className="suggestion" onClick={() => go(linkFor(sug))}>
              <div className="row">
                <span className="tag"><Icon name="autopilot" size={12} />Optimization</span><span className="tag">AOP</span>
              </div>
              <h3>{sug.title}</h3>
              <span className="muted small">{e.handed} of {e.count} {sug.category.toLowerCase()} chats reached a person in the last {e.days} days.</span>
              <div className="foot">
                <span className="row"><Icon name="conversations" size={14} />{e.perWeek} convos/wk</span>
                <span className="gain">↗ +{e.gain} contained conversations per week</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="row-between">
        <div className="section-title"><Icon name="analyze" />Metrics<Info text="Live customer chats only. Preview and simulation chats are left out." /></div>
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
            <Stat value={s.conversations.toLocaleString()} label="Total conversations"
              hint={`Live chats in the last ${s.days} days where the customer sent at least one message.`} />
            <Stat value={percent(s.handled_by_agent, s.conversations)} label="Deflection rate"
              hint="Share of chats the agent resolved on its own, without handing them to a Bookly employee." />
            <Stat
              value={`$${(s.handled_by_agent * COST_PER_HUMAN_CHAT).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              label="Cost savings"
              hint={`Chats the agent resolved (${s.handled_by_agent.toLocaleString()}) × $${COST_PER_HUMAN_CHAT.toFixed(2)}, the average cost of a chat handled by a person.`}
            />
            <Stat value={s.csat.average?.toFixed(1) ?? "–"} label="CSAT"
              hint={`Customer satisfaction: the average rating out of 5, from the ${s.csat.rated.toLocaleString()} customers who rated their chat.`} />
          </div>
        </div>
        <div className="card">
          <h2>Conversation volume<Info text="Chats started each day (or week). Deflected are the ones the agent resolved without a person. The gap between the lines is what reached your team." /></h2>
          <TimeChart dates={dates} series={[
            { name: "Total", color: VOLUME.total, values: rows.map((r) => r.total), fill: true },
            { name: "Deflected", color: VOLUME.deflected, values: rows.map((r) => r.deflected), fill: true },
          ]} />
        </div>
      </div>

      <div className="home-grid-3">
        <div className="card">
          <h2>Customer satisfaction<Info text="How customers rated their chat when asked at the end, from Very helpful (5) to Very unhelpful (1)." /></h2>
          <p className="muted small">{s.csat.rated} rated chats</p>
          <RatingBars counts={s.csat.counts} />
        </div>
        <div className="card">
          <h2>CSAT trends<Info text={`The average rating each day, out of 5. Days with fewer than ${MIN_FOR_RATE} chats, like today so far, are left out.`} /></h2>
          <TimeChart dates={dates} height={190} min={1} max={5} series={[{ name: "CSAT", color: VOLUME.total, values: rows.map((r) => (r.total >= MIN_FOR_RATE ? r.csat : null)) }]} />
        </div>
        <div className="card">
          <h2>Deflection rate trends<Info text={`The share of each day's chats the agent resolved on its own. Days with fewer than ${MIN_FOR_RATE} chats, like today so far, are left out.`} /></h2>
          <TimeChart dates={dates} height={190} max={100} format={(v) => `${Math.round(v)}%`}
            series={[{ name: "Deflection rate", color: VOLUME.total, fill: true, values: rows.map((r) => (r.total >= MIN_FOR_RATE ? Math.round((r.deflected / r.total) * 1000) / 10 : null)) }]} />
        </div>
      </div>
    </div>
  );
}
