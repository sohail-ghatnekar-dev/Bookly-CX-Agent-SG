// SVG charts for Home and Insights, in the platform's style: soft gradient fills under smooth lines, a pastel donut
// labelled around its edge, and indigo gradient bars. Every chart reads out its values on hover.
import { useEffect, useId, useRef, useState } from "react";
import { DONUT, OTHER_SLICE, RATING } from "../lib/colors";

export function Stat({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}{hint && <span className="info-dot small-dot" title={hint}>i</span>}</div>
    </div>
  );
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

const PAD = { left: 42, right: 12, top: 10, bottom: 24 };
const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "numeric", day: "numeric" });

// A top for four even gridline steps of 1, 2, 2.5 or 5 × a power of ten: 83 → 100 (0, 25, 50, 75, 100).
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const raw = value / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw)! * 4;
}

// A smooth line through the points that never overshoots them (monotone cubic), as an SVG path.
function smooth(points: [number, number][]): string {
  if (points.length < 3) return points.map(([x, y], i) => `${i ? "L" : "M"}${x},${y}`).join("");
  const n = points.length;
  const dx = points.slice(1).map(([x], i) => x - points[i][0]);
  const slope = points.slice(1).map(([, y], i) => (y - points[i][1]) / dx[i]);
  const m = points.map((_, i) => {
    if (i === 0) return slope[0];
    if (i === n - 1) return slope[n - 2];
    return slope[i - 1] * slope[i] <= 0 ? 0 : (2 * slope[i - 1] * slope[i]) / (slope[i - 1] + slope[i]);
  });
  let d = `M${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = dx[i] / 3;
    d += `C${x0 + h},${y0 + m[i] * h} ${x1 - h},${y1 - m[i + 1] * h} ${x1},${y1}`;
  }
  return d;
}

interface Series {
  name: string;
  color: string;
  values: (number | null)[];
  fill?: boolean;
}

// Time series on one axis: gradient areas or lines, a crosshair, and a readout of every series on hover.
export function TimeChart({ dates, series, max, min = 0, height = 220, format = (v) => String(v) }: {
  dates: string[];
  series: Series[];
  max?: number;
  min?: number;
  height?: number;
  format?: (v: number) => string;
}) {
  const id = useId().replace(/:/g, "");
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const top = max ?? niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const w = Math.max(width, 200);
  const x = (i: number) => PAD.left + (i / Math.max(dates.length - 1, 1)) * (w - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / (top - min)) * (height - PAD.top - PAD.bottom);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => min + f * (top - min));

  // Runs of consecutive days with a value; a day without one breaks the line.
  const runs = (values: (number | null)[]) => {
    const out: [number, number][][] = [];
    let run: [number, number][] = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (run.length) out.push(run);
        run = [];
      } else run.push([x(i), y(v)]);
    });
    if (run.length) out.push(run);
    return out;
  };

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - box.left - PAD.left) / (w - PAD.left - PAD.right)) * (dates.length - 1));
    setHover(Math.max(0, Math.min(dates.length - 1, i)));
  }

  return (
    <div className="chart" ref={ref}>
      <svg width={w} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)} role="img"
        aria-label={`${series.map((s) => s.name).join(" and ")} by day`}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.name} id={`${id}-g${i}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.42} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0.1} />
            </linearGradient>
          ))}
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(t)} y2={y(t)} className="grid" />
            <text x={PAD.left - 8} y={y(t)} className="axis" textAnchor="end" dominantBaseline="middle">{format(Math.round(t * 10) / 10)}</text>
          </g>
        ))}
        {dates.map((d, i) => ((i % 7 === 0 && i < dates.length - 4) || i === dates.length - 1) && (
          <text key={d} x={x(i)} y={height - 6} className="axis" textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}>{shortDate(d)}</text>
        ))}
        {series.map((s, i) => s.fill && runs(s.values).map((run, j) => (
          <path key={`${s.name}-a${j}`} d={`${smooth(run)}L${run.at(-1)![0]},${y(min)}L${run[0][0]},${y(min)}Z`} fill={`url(#${id}-g${i})`} />
        )))}
        {series.map((s) => runs(s.values).map((run, j) => (
          <path key={`${s.name}-l${j}`} d={smooth(run)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        )))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={height - PAD.bottom} className="crosshair" />
            {series.map((s) => s.values[hover] !== null && (
              <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r={4.5} fill={s.color} stroke="#fff" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {series.length > 1 && (
        <div className="legend center">
          {series.map((s) => <span key={s.name}><i className="line-key" style={{ background: s.color }} />{s.name}</span>)}
        </div>
      )}
      {hover !== null && (
        <div className="tip" style={{ left: Math.min(x(hover) + 12, w - 170), top: 20 }}>
          <div className="tip-title">{new Date(`${dates[hover]}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</div>
          {series.map((s) => (
            <div key={s.name} className="tip-row"><i style={{ background: s.color }} />{s.name}<b>{s.values[hover] === null ? "–" : format(s.values[hover]!)}</b></div>
          ))}
        </div>
      )}
    </div>
  );
}

// Darker text in a slice's own hue, so a pastel label stays readable.
function ink(hex: string, amount = 0.45): string {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v * (1 - amount)));
  return `rgb(${c.join(",")})`;
}

// Part of a whole: a pastel donut with each slice labelled around the edge, and its count and share on hover.
export function Donut({ slices }: { slices: { name: string; count: number; color?: string }[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = slices.reduce((a, s) => a + s.count, 0) || 1;
  const cx = 300;
  const cy = 150;
  const r = 100;
  const inner = 60;
  let angle = -Math.PI / 2;
  const arcs = slices.map((s, i) => {
    const sweep = (s.count / total) * Math.PI * 2;
    const a0 = angle;
    angle += sweep;
    const color = s.color ?? (s.name === "Other" ? OTHER_SLICE : DONUT[i % DONUT.length]);
    return { ...s, a0, a1: angle, mid: a0 + sweep / 2, color };
  });
  const at = (a: number, radius: number): [number, number] => [cx + radius * Math.cos(a), cy + radius * Math.sin(a)];
  const arcPath = (a0: number, a1: number) => {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const [x0, y0] = at(a0, r);
    const [x1, y1] = at(a1, r);
    const [x2, y2] = at(a1, inner);
    const [x3, y3] = at(a0, inner);
    return `M${x0},${y0}A${r},${r} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${inner},${inner} 0 ${large} 0 ${x3},${y3}Z`;
  };

  // Labels sit outside the ring on their slice's side, nudged apart so small neighbours don't overlap.
  const labels = arcs.map((a) => {
    const right = Math.cos(a.mid) >= 0;
    const [ex, ey] = at(a.mid, r + 4);
    const [kx, ky] = at(a.mid, r + 18);
    return { ...a, right, ex, ey, kx, ky, ly: ky };
  });
  for (const side of [true, false]) {
    const group = labels.filter((l) => l.right === side).sort((p, q) => p.ky - q.ky);
    for (let i = 1; i < group.length; i++) group[i].ly = Math.max(group[i].ly, group[i - 1].ly + 16);
  }
  const shown = arcs.find((a) => a.name === hover);

  return (
    <svg className="donut" viewBox="0 0 600 300" role="img" aria-label="Conversations by category">
      {arcs.map((a) => (
        <path key={a.name} d={arcPath(a.a0, a.a1)} fill={a.color} stroke="#fff" strokeWidth={2}
          opacity={hover && hover !== a.name ? 0.45 : 1} onMouseEnter={() => setHover(a.name)} onMouseLeave={() => setHover(null)}>
          <title>{`${a.name}: ${a.count} (${Math.round((a.count / total) * 100)}%)`}</title>
        </path>
      ))}
      {labels.map((l) => (
        <g key={l.name} onMouseEnter={() => setHover(l.name)} onMouseLeave={() => setHover(null)}>
          <polyline points={`${l.ex},${l.ey} ${l.kx},${l.ly} ${l.kx + (l.right ? 10 : -10)},${l.ly}`} fill="none" stroke={l.color} strokeWidth={1.2} />
          <text x={l.kx + (l.right ? 14 : -14)} y={l.ly} dominantBaseline="middle" textAnchor={l.right ? "start" : "end"} className="donut-label" fill={ink(l.color)}>
            {l.name}
          </text>
        </g>
      ))}
      <text x={cx} y={cy - 4} textAnchor="middle" className="donut-num">{shown ? shown.count : total.toLocaleString()}</text>
      <text x={cx} y={cy + 16} textAnchor="middle" className="axis">{shown ? `${Math.round((shown.count / total) * 100)}% · ${shown.name}` : "conversations"}</text>
    </svg>
  );
}

// CSAT: one bar per rating, very helpful at the top, green through red, with the count beside each bar.
export function RatingBars({ counts }: { counts: number[] }) {
  const labels = ["Very unhelpful", "Unhelpful", "Somewhat helpful", "Helpful", "Very helpful"];
  const max = Math.max(1, ...counts);
  return (
    <div className="ratings">
      {[4, 3, 2, 1, 0].map((i) => (
        <div key={i} className="rating-row" title={`${labels[i]} (${i + 1} of 5): ${counts[i]}`}>
          <span className="rating-label">{labels[i]}</span>
          <span className="rating-track"><span className="rating-fill" style={{ width: `${(counts[i] / max) * 100}%`, background: RATING[i] }} /></span>
          <span className="mono rating-count">{counts[i].toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(",")})`;
}

// Horizontal indigo bars that lighten row by row, with each row's share at the end.
export function ShareBars({ rows }: { rows: { label: string; count: number }[] }) {
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="share-bars">
      {rows.map((r, i) => {
        const pct = Math.round((r.count / total) * 100);
        const light = i / Math.max(rows.length - 1, 1);
        return (
          <div key={r.label} className="share-row" title={`${r.label}: ${r.count} (${pct}%)`}>
            <span className="share-label">{r.label}</span>
            <span className="share-track">
              <span className="share-fill" style={{ width: `${Math.max(2, (r.count / max) * 100)}%`, background: `linear-gradient(90deg, ${mix("#544de4", "#9f9af3", light)}, ${mix("#6d67ea", "#bbb7f6", light)})` }} />
            </span>
            <span className="mono share-pct">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

// Chats by hour of day: lavender gradient columns, with the busiest hour in orange and the quietest in indigo.
export function HourlyBars({ counts }: { counts: number[] }) {
  const id = useId().replace(/:/g, "");
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 220;
  const w = Math.max(width, 300);
  const top = niceMax(Math.max(1, ...counts));
  const peak = counts.indexOf(Math.max(...counts));
  const off = counts.indexOf(Math.min(...counts));
  const slot = (w - PAD.left - PAD.right) / 24;
  const y = (v: number) => PAD.top + (1 - v / top) * (height - PAD.top - PAD.bottom);
  const hourName = (h: number) => `${h % 12 || 12}${h < 12 ? "am" : "pm"}`;

  return (
    <div className="chart" ref={ref}>
      <svg width={w} height={height} role="img" aria-label="Conversations by hour of day" onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={`${id}-bar`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#aaa5f5" />
            <stop offset="100%" stopColor="#efeefd" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(f * top)} y2={y(f * top)} className="grid" />
            <text x={PAD.left - 8} y={y(f * top)} className="axis" textAnchor="end" dominantBaseline="middle">{Math.round(f * top)}</text>
          </g>
        ))}
        {counts.map((c, h) => {
          const bx = PAD.left + h * slot + slot * 0.14;
          const bw = slot * 0.72;
          const fill = h === peak ? "#ea5a2a" : h === off ? "#5a52e6" : `url(#${id}-bar)`;
          return (
            <g key={h} onMouseEnter={() => setHover(h)}>
              <rect x={PAD.left + h * slot} y={PAD.top} width={slot} height={height - PAD.top - PAD.bottom} fill="transparent" />
              <path d={`M${bx},${y(0)}V${y(c) + 4}Q${bx},${y(c)} ${bx + 4},${y(c)}H${bx + bw - 4}Q${bx + bw},${y(c)} ${bx + bw},${y(c) + 4}V${y(0)}Z`}
                fill={fill} opacity={hover === null || hover === h ? 1 : 0.6} />
            </g>
          );
        })}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={PAD.left + h * slot} y={height - 6} className="axis" textAnchor={h === 0 ? "start" : h === 24 ? "end" : "middle"}>{hourName(h % 24)}</text>
        ))}
      </svg>
      {hover !== null && (
        <div className="tip" style={{ left: Math.min(PAD.left + hover * slot + slot, w - 170), top: 10 }}>
          <div className="tip-title">{hourName(hover)} – {hourName((hover + 1) % 24)} PT</div>
          <div className="tip-row">Conversations<b>{counts[hover]}</b></div>
        </div>
      )}
      <div className="hour-tiles">
        <div className="hour-tile"><i style={{ background: "#ea5a2a" }} /><b>{hourName(peak)} – {hourName((peak + 1) % 24)}</b><span className="muted small">Peak hour (PT)</span></div>
        <div className="hour-tile"><i style={{ background: "#5a52e6" }} /><b>{hourName(off)} – {hourName((off + 1) % 24)}</b><span className="muted small">Off hour (PT)</span></div>
      </div>
    </div>
  );
}
