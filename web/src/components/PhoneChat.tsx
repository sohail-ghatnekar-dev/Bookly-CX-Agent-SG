// The iPhone app's chat screen, in the browser: same layout, colours, bookworm, suggestions and handoff card as
// ChatView.swift. Messages go through the console's test chat; the log beside the phone shows every step.
import { useEffect, useRef, useState } from "react";
import { api, type ChatReply, type Escalation } from "../lib/api";
import { Bookworm } from "./Bookworm";

interface Turn {
  user: string;
  reply?: string;
  citations: string[];
}

const STARTERS = ["Where's my order?", "I'd like to return a book", "How long does shipping take?"];
const PHRASES = [
  "Let me check the archives…",
  "Flipping through the pages…",
  "Checking the shelves…",
  "Looking it up in the ledger…",
  "Dusting off the records…",
];
export function PhoneChat({ testing, onReply, onNewConversation }: {
  testing?: { name: string; version: number };
  onReply?: (reply: ChatReply) => void;
  onNewConversation?: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [escalation, setEscalation] = useState<Escalation | null>(null);
  const [escalated, setEscalated] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    el?.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [turns, sending, suggestions, escalated, error]);

  function newConversation() {
    setTurns([]);
    setConversationId(null);
    setSuggestions([]);
    setEscalation(null);
    setEscalated(false);
    setError(null);
    setFailed(null);
    onNewConversation?.();
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || sending) return;
    setTurns((t) => [...t, { user: message, citations: [] }]);
    await deliver(message);
  }

  async function deliver(message: string) {
    setSending(true);
    setError(null);
    setFailed(null);
    setSuggestions([]);
    try {
      const r = await api.chat(message, conversationId, testing);
      setConversationId(r.conversation_id);
      setTurns((t) => t.map((turn, i) => i === t.length - 1 ? { ...turn, reply: r.reply, citations: r.citations } : turn));
      setEscalated(r.status === "escalated");
      if (r.escalation) setEscalation(r.escalation);
      setSuggestions(r.suggestions ?? []);
      onReply?.(r);
    } catch (e) {
      setFailed(message);
      setError((e as Error).message || "Couldn't reach Bookly. Check your connection.");
    } finally {
      setSending(false);
    }
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    const text = draft;
    setDraft("");
    void send(text);
  }

  return (
    <div className="phone-wrap">
      <div className="phone">
        <div className="phone-screen">
          <div className="p-status">
            <span>9:41</span>
            <span className="p-island" />
            <span className="p-status-icons" aria-hidden="true">
              <svg width="18" height="11" viewBox="0 0 18 11"><rect x="0" y="7" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="6" rx="1" /><rect x="10" y="2.5" width="3" height="8.5" rx="1" /><rect x="15" y="0" width="3" height="11" rx="1" /></svg>
              <svg width="16" height="11" viewBox="0 0 16 11"><path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.2-1.3C13.3 1.4 10.8.4 8 .4S2.7 1.4.8 3.3L2 4.6c1.6-1.5 3.7-2.4 6-2.4Zm0 3.4c1.4 0 2.6.5 3.6 1.4l1.2-1.3C11.5 4.5 9.8 3.8 8 3.8s-3.5.7-4.8 1.9L4.4 7c1-.9 2.2-1.4 3.6-1.4Zm0 3.3c-.6 0-1.2.2-1.6.6L8 11l1.6-1.5c-.4-.4-1-.6-1.6-.6Z" /></svg>
              <svg width="27" height="12" viewBox="0 0 27 12"><rect x="0.5" y="0.5" width="22" height="11" rx="3.5" fill="none" stroke="currentColor" strokeOpacity="0.4" /><rect x="2" y="2" width="19" height="8" rx="2" /><rect x="24" y="4" width="1.6" height="4" rx="0.8" fillOpacity="0.4" /></svg>
            </span>
          </div>

          <header className="p-nav">
            <div className="p-title">
              <Bookworm size={30} />
              <div>
                <div className="p-title-name">Bookly</div>
                <div className="p-title-sub">Support bookworm</div>
              </div>
            </div>
            <div className="p-nav-actions">
              <button className="p-new" aria-label="New chat" title="New chat" disabled={sending} onClick={newConversation}>
                <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="9.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M11 6.6v8.8M6.6 11h8.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
              </button>
            </div>
          </header>

          <div className="p-scroll" ref={scroller}>
            {turns.length === 0 && (
              <div className="p-empty">
                <Bookworm size={76} />
                <div>
                  <h2 className="p-display">How can we help?</h2>
                  <p className="p-prose p-muted">I’m Bookly’s support bookworm. Ask about an order, a return, or our policies.</p>
                </div>
                <div className="p-starters">
                  {STARTERS.map((s) => <button key={s} className="p-chip" onClick={() => send(s)}>{s}</button>)}
                </div>
              </div>
            )}
            {turns.map((turn, i) => (
              <div key={i} className="p-turn">
                <div className="p-bubble p-customer">{turn.user}</div>
                {turn.reply !== undefined && (
                  <>
                    <div className="p-agent-row">
                      <Bookworm />
                      <div className="p-bubble p-agent">{turn.reply}</div>
                    </div>
                    {turn.citations.length > 0 && (
                      <div className="p-indent p-under">
                        <div className="p-caption p-muted p-policy">Policy · {turn.citations.join(", ")}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {sending && <Typing />}
            {!sending && !escalated && !error && suggestions.length > 0 && (
              <div className="p-indent p-suggestions">
                {suggestions.map((s) => <button key={s} className="p-chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            )}
            {error && (
              <div className="p-indent p-error">
                <span>{error}</span>
                {failed && <button onClick={() => deliver(failed)}>Retry</button>}
              </div>
            )}
            {escalated && escalation && <HandoffCard escalation={escalation} onNewChat={newConversation} />}
          </div>

          <form className="p-input" onSubmit={submit}>
            <input
              value={draft}
              disabled={escalated}
              placeholder={escalated ? "A Bookly employee has your case" : "Write a message"}
              maxLength={1000}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Message"
            />
            <button type="submit" className="p-send" aria-label="Send" disabled={escalated || sending || !draft.trim()}>
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.5V2.8M3.2 7.4 8 2.6l4.8 4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </form>
          <div className="p-home"><span /></div>
        </div>
      </div>
      <div className="phone-foot muted small">
        {testing ? `${testing.name} v${testing.version} under test · other AOPs live` : "Live AOPs, as customers see them"}
      </div>
    </div>
  );
}


// While the agent works: the bookworm's book, empty, and a status line that changes every couple of seconds.
function Typing() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % PHRASES.length), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="p-agent-row p-typing" aria-label="Bookly is checking the archives">
      <Bookworm empty />
      <div className="p-bubble p-agent p-typing-bubble">{PHRASES[i]}</div>
    </div>
  );
}

function HandoffCard({ escalation, onNewChat }: { escalation: Escalation; onNewChat: () => void }) {
  return (
    <div className="p-indent p-handoff">
      <div className="p-card">
        <h3 className="p-heading">Sent to an employee</h3>
        <div className="p-caption p-muted">What the employee sees</div>
        <p className="p-prose">{escalation.summary}</p>
        <hr />
        <Row label="Verified" value={escalation.verified ? "Yes" : "No"} />
        <Row label="Rule" value={escalation.rule_ids.length ? escalation.rule_ids.join(", ") : "None"} />
        <Row label="Reply time" value="Within 1 business day" />
      </div>
      <button className="p-link" onClick={onNewChat}>Start a new chat</button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-row">
      <span className="p-caption p-muted">{label}</span>
      <span className="p-label">{value}</span>
    </div>
  );
}
