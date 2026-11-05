// Preview › Email and Voice: how the same AOPs look on other channels. These play a scripted conversation; only
// Chat talks to the live agent in this demo.
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

const clock = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

// Daniel calls about his late order; the agent follows the Late orders steps.
const CALL: { who: "agent" | "customer"; text: string }[] = [
  { who: "agent", text: "Thanks for calling Bookly support. How can I help you today?" },
  { who: "customer", text: "Hi, yeah, my order still hasn't shown up. It was supposed to be here a few days ago." },
  { who: "agent", text: "I'm sorry about that, I can look into it. What's the order number, and the email address on the order?" },
  { who: "customer", text: "It's B K one zero seven two, and the email is daniel dot okafor at example dot com." },
  { who: "agent", text: "Thanks, Daniel, you're verified. Order BK-1072, Tomorrow, and Tomorrow, and Tomorrow, is with USPS and it's three days past its estimate. Most late parcels arrive within two business days of a missed estimate. Would you like me to email you an update tomorrow morning, so you don't have to call back?" },
  { who: "customer", text: "Yes please, that would be great." },
  { who: "agent", text: "Done. You'll get an email tomorrow at 9 AM Eastern, at the address on your account, with the latest from USPS. Is there anything else I can help with?" },
  { who: "customer", text: "No, that's it. Thanks." },
  { who: "agent", text: "Happy reading, Daniel. Goodbye." },
];

const METADATA = [
  ["channel", "voice"],
  ["caller.phone", "+1 (555) 014-2271"],
  ["customer.first_name", "unknown until verified"],
  ["customer.verified", "no"],
  ["customer.order_count", "unknown until verified"],
  ["customer.open_orders", "unknown until verified"],
  ["customer.is_new", "unknown until verified"],
];

type CallState = "ready" | "connecting" | "live" | "ended";

export function VoicePreview() {
  const [state, setState] = useState<CallState>("ready");
  const [lines, setLines] = useState<{ who: "agent" | "customer"; text: string; at: Date }[]>([]);
  const [speaking, setSpeaking] = useState<"agent" | "customer" | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const timers = useRef<number[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lines]);
  useEffect(() => {
    if (state !== "live") return;
    const t = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [state]);

  function start() {
    timers.current.forEach(clearTimeout);
    setLines([]);
    setSeconds(0);
    setState("connecting");
    let at = 1600;
    timers.current = [window.setTimeout(() => setState("live"), at)];
    CALL.forEach((line) => {
      at += 400;
      timers.current.push(window.setTimeout(() => setSpeaking(line.who), at));
      at += Math.min(4200, 900 + line.text.length * 22);
      timers.current.push(window.setTimeout(() => {
        setLines((l) => [...l, { ...line, at: new Date() }]);
        setSpeaking(null);
      }, at));
    });
    timers.current.push(window.setTimeout(() => setState("ended"), at + 900));
  }

  function hangUp() {
    timers.current.forEach(clearTimeout);
    setSpeaking(null);
    setState("ended");
  }

  const statusLabel = { ready: "Ready", connecting: "Connecting", live: "In call", ended: "Ended" }[state];

  return (
    <div className="stack-16">
      <div className="card">
        <button className="advanced-row" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced}>
          <div><b>Advanced</b><div className="muted small">{METADATA.length} metadata fields</div></div>
          <span className={`chev${advanced ? " open" : ""}`}><Icon name="chevron" /></span>
        </button>
        {advanced && (
          <table className="log" style={{ marginTop: 10 }}>
            <tbody>
              {METADATA.map(([k, v]) => (
                <tr key={k} className="static"><td className="mono ref-meta" style={{ width: 260 }}>{`{{ ${k} }}`}</td><td className="muted">{v}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Test call</h2>
          <span className={`pill ${state === "live" ? "ok" : state === "connecting" ? "info" : ""}`}>{statusLabel}</span>
          <span className="spacer" />
          <span className="muted small">Uses the same AOPs as chat, written once for every channel</span>
        </div>
        <div className="voice-layout">
          <div className="dialer">
            <div className="dialer-island" />
            <div className="dialer-number">{state === "live" ? "Bookly support" : "Phone: +1 (555) 014-2271"}</div>
            {state === "live" && <div className="dialer-timer">{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</div>}
            <div className="keypad">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"].map((k) => <span key={k}>{k}</span>)}
            </div>
          </div>
          <div className="voice-side">
            <div className="row" style={{ gap: 10 }}>
              {state === "live" || state === "connecting" ? (
                <>
                  <div className="meter"><span>Mic input</span><Bars on={speaking === "customer"} /></div>
                  <div className="meter"><span>Agent audio</span><Bars on={speaking === "agent"} /></div>
                  <button className="hangup" onClick={hangUp} aria-label="End call"><Icon name="hangup" /></button>
                </>
              ) : (
                <button className="primary start" onClick={start}>Start</button>
              )}
            </div>
            <div className="card transcript">
              <div className="row-between"><h3 style={{ margin: 0 }}>Transcript</h3><span className="muted small row">View convo <Icon name="external" size={13} /></span></div>
              <div className="transcript-body" ref={scroller}>
                {state === "ready" && <p className="muted small" style={{ textAlign: "center", marginTop: 60 }}>Press Start to place a test call.</p>}
                {state === "connecting" && <p className="muted small" style={{ textAlign: "center", marginTop: 60 }}>Connecting…</p>}
                {lines.map((l, i) => (
                  <div key={i} className={`t-line ${l.who}`}>
                    <div className="t-time">{clock(l.at)}</div>
                    <div className="t-bubble">{l.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bars({ on }: { on: boolean }) {
  return (
    <span className={`bars${on ? " on" : ""}`} aria-hidden="true">
      {Array.from({ length: 12 }, (_, i) => <i key={i} style={{ animationDelay: `${(i % 5) * 0.09}s` }} />)}
    </span>
  );
}

// Maya emails about a damaged book; the Returns AOP answers by email, in one reply.
const EMAIL = {
  from: "maya.chen@example.com",
  subject: "Damaged book, order BK-1042",
  body: "Hi,\n\nMy copy of Circe arrived with a cracked spine. Can I send it back for a refund?\n\nThanks,\nMaya",
};
const REPLY = `Hi Maya,

I'm sorry your copy of Circe arrived damaged. I've checked order BK-1042, and because it arrived damaged it can be returned within 60 days of delivery, so you're well within the window.

I've started the return for you. Your return number is RMA-482913. Please pack the book with the return number inside and send it back to us; your refund goes to your original payment method within 5-7 business days after it arrives.

If there's anything else I can help with, just reply to this email.

Happy reading,
The Bookly team`;
const STEPS = [
  ["procedure", "returns v4"],
  ["verify_customer", "sender email matches BK-1042"],
  ["get_order_status", "BK-1042 delivered"],
  ["eligibility", "eligible RET-60 12/60d"],
  ["initiate_return", "RMA issued"],
];

export function EmailPreview() {
  const [state, setState] = useState<"draft" | "sending" | "replied">("draft");
  const [body, setBody] = useState(EMAIL.body);
  const [sentAt, setSentAt] = useState<Date | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function send() {
    setSentAt(new Date());
    setState("sending");
    timer.current = window.setTimeout(() => setState("replied"), 2600);
  }

  return (
    <div className="card">
      <div className="card-head">
        <h2>Test email</h2>
        <span className={`pill ${state === "replied" ? "ok" : state === "sending" ? "info" : ""}`}>{state === "draft" ? "Draft" : state === "sending" ? "Agent is replying" : "Replied"}</span>
        <span className="spacer" />
        <span className="muted small">Uses the same AOPs as chat, written once for every channel</span>
        {state !== "draft" && <button className="ghost" onClick={() => setState("draft")}>New email</button>}
      </div>
      <div className="email-layout">
        <div className="email-thread">
          {state === "draft" ? (
            <div className="email compose">
              <div className="email-field"><span>From</span>{EMAIL.from}</div>
              <div className="email-field"><span>To</span>support@bookly.com</div>
              <div className="email-field"><span>Subject</span>{EMAIL.subject}</div>
              <textarea className="email-body" value={body} onChange={(e) => setBody(e.target.value)} rows={8} aria-label="Email body" />
              <div className="row-end"><button className="primary" onClick={send}><Icon name="send" size={14} />Send</button></div>
            </div>
          ) : (
            <>
              <div className="email">
                <div className="email-meta"><b>Maya Chen</b> &lt;{EMAIL.from}&gt;<span className="muted">{sentAt && clock(sentAt)}</span></div>
                <div className="muted small">To support@bookly.com · {EMAIL.subject}</div>
                <p className="email-text">{body}</p>
              </div>
              {state === "sending" ? (
                <div className="email muted small">The agent is reading the email and checking the order…</div>
              ) : (
                <div className="email reply">
                  <div className="email-meta"><b>Bookly Support</b> &lt;support@bookly.com&gt;<span className="muted">{sentAt && clock(new Date(sentAt.getTime() + 60_000))}</span></div>
                  <div className="muted small">To {EMAIL.from} · Re: {EMAIL.subject}</div>
                  <p className="email-text">{REPLY}</p>
                </div>
              )}
            </>
          )}
        </div>
        <div className="card email-steps">
          <div className="eyebrow">Log</div>
          {state !== "replied" ? (
            <p className="muted small" style={{ marginTop: 8 }}>Send the email to see each step the agent takes.</p>
          ) : (
            <ol className="steps" style={{ marginTop: 8 }}>
              {STEPS.map(([label, detail]) => (
                <li key={label} className="step">
                  <div className="step-row"><span className="mono step-label">{label}</span><span className="step-detail">{detail}</span><span className="pill ok">ok</span></div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
