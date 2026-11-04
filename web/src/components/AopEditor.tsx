// The AOP Logic editor: plain text, with @tool references in purple, #AOP references in orange and {{ metadata }}
// in teal. Typing @, # or {{ opens a list to pick from. A textarea sits on top of a coloured copy of its own text, so editing stays native.
import { useLayoutEffect, useRef, useState } from "react";
import { segments, typing } from "../lib/refs";

interface Option {
  id: string;
  label: string;
  desc: string;
  insert: string;
}

const KIND_CLASS = { tool: "ref-tool", aop: "ref-aop", meta: "ref-meta" };
const HEADS = { "@": "Tools", "#": "AOPs", "{{": "Customer metadata" };

export function AopEditor({ value, onChange, tools, aops, metadata }: {
  value: string;
  onChange: (value: string) => void;
  tools: { name: string; description: string }[];
  aops: { name: string; title: string; goal: string }[];
  metadata: { key: string; description: string }[];
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [pick, setPick] = useState(0);
  const [dismissed, setDismissed] = useState(-1);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const token = typing(value, caret);
  const options: Option[] = !token || dismissed === token.start ? [] : token.sigil === "@"
    ? tools.filter((t) => t.name.includes(token.query)).map((t) => ({ id: t.name, label: `@${t.name}`, desc: t.description, insert: `@${t.name}` }))
    : token.sigil === "#"
    ? aops.filter((a) => a.name.includes(token.query) || a.title.toLowerCase().includes(token.query))
      .map((a) => ({ id: a.name, label: `#${a.name}`, desc: `${a.title}: ${a.goal}`, insert: `#${a.name}` }))
    : metadata.filter((m) => m.key.includes(token.query))
      .map((m) => ({ id: m.key, label: `{{ ${m.key} }}`, desc: m.description, insert: `{{ ${m.key} }}` }));
  const open = options.length > 0;

  // The textarea grows with its text instead of scrolling, so the coloured copy behind it wraps the same way.
  // It also puts the caret after a reference picked from the list, as soon as the new text is in.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
    if (pendingCaret.current !== null) {
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  // Put the list under the caret: measure where the text before the caret ends.
  useLayoutEffect(() => {
    if (!open || !measure.current || !area.current) return;
    const marker = measure.current.querySelector("span");
    if (!marker) return;
    setPos({ top: marker.offsetTop + 26, left: Math.min(marker.offsetLeft, area.current.clientWidth - 340) });
  }, [open, caret, value]);

  function sync() {
    setCaret(area.current!.selectionStart);
  }

  function insert(option: Option) {
    if (!token) return;
    // A metadata key may already have its closing braces typed after the caret; don't double them.
    const rest = token.sigil === "{{" ? value.slice(caret).replace(/^\s*\}\}/, "") : value.slice(caret);
    const next = value.slice(0, token.start) + option.insert + " " + rest;
    pendingCaret.current = token.start + option.insert.length + 1;
    onChange(next);
    setPick(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") setPick((p) => (p + 1) % options.length);
    else if (e.key === "ArrowUp") setPick((p) => (p - 1 + options.length) % options.length);
    else if (e.key === "Enter" || e.key === "Tab") insert(options[Math.min(pick, options.length - 1)]);
    else if (e.key === "Escape") setDismissed(token!.start);
    else return;
    e.preventDefault();
  }

  const known = { tool: tools.map((t) => t.name), aop: aops.map((a) => a.name), meta: metadata.map((m) => m.key) };

  return (
    <div className="editor-wrap">
      <div className="ed-layer" aria-hidden="true">
        {segments(value, known).map((s, i) =>
          s.kind ? <span key={i} className={s.known ? KIND_CLASS[s.kind] : "ref-bad"}>{s.text}</span> : s.text
        )}
        {"​"}
      </div>
      <div className="ed-layer" ref={measure} aria-hidden="true" style={{ visibility: "hidden" }}>
        {value.slice(0, token?.start ?? caret)}<span>@</span>
      </div>
      <textarea
        ref={area}
        value={value}
        spellCheck
        aria-label="AOP logic"
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart);
          setPick(0);
        }}
        onSelect={sync}
        onKeyDown={onKeyDown}
        onBlur={() => setTimeout(() => token && setDismissed(token.start), 150)}
        onFocus={() => setDismissed(-1)}
      />
      {open && (
        <div className="suggest" style={{ top: pos.top, left: Math.max(8, pos.left) }} role="listbox">
          <div className="suggest-head eyebrow">{HEADS[token!.sigil]}</div>
          {options.map((o, i) => (
            <button
              key={o.id}
              role="option"
              aria-selected={i === pick}
              className={i === pick ? "active" : ""}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(o);
              }}
            >
              <span className={`mono ${token!.sigil === "@" ? "ref-tool" : token!.sigil === "#" ? "ref-aop" : "ref-meta"}`}>{o.label}</span>
              <span className="desc">{o.desc}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
