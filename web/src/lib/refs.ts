// References in AOP text: @tool, #aop and {{ metadata }}. @ and # count at the start of a line or after a space or
// bracket, so an email address isn't a tool reference. The console function applies the same rules when it saves.
const REF = /(^|[\s(])([@#])([a-z][a-z0-9_]*)|\{\{\s*([a-z][a-z0-9_.]*)\s*\}\}/g;

export type Kind = "tool" | "aop" | "meta";
export type Segment = { text: string; kind?: Kind; known?: boolean };

export function toolRefs(body: string): string[] {
  return [...new Set([...body.matchAll(REF)].filter((m) => m[2] === "@").map((m) => m[3]))];
}

export function aopRefs(body: string): string[] {
  return [...new Set([...body.matchAll(REF)].filter((m) => m[2] === "#").map((m) => m[3]))];
}

export function metaRefs(body: string): string[] {
  return [...new Set([...body.matchAll(REF)].filter((m) => m[4]).map((m) => m[4]))];
}

// The text cut into plain runs and references, for colouring the editor.
export function segments(body: string, known: Record<Kind, string[]>): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of body.matchAll(REF)) {
    const start = m.index! + (m[1]?.length ?? 0);
    if (start > at) out.push({ text: body.slice(at, start) });
    if (m[4]) {
      out.push({ text: m[0], kind: "meta", known: known.meta.includes(m[4]) });
      at = m.index! + m[0].length;
    } else {
      const kind = m[2] === "@" ? "tool" : "aop";
      out.push({ text: m[2] + m[3], kind, known: known[kind].includes(m[3]) });
      at = start + 1 + m[3].length;
    }
  }
  if (at < body.length) out.push({ text: body.slice(at) });
  return out;
}

// The reference being typed right before the caret, if any: "@get_or" → { sigil: "@", query: "get_or" }.
export function typing(body: string, caret: number): { sigil: "@" | "#" | "{{"; query: string; start: number } | null {
  const before = body.slice(0, caret);
  const meta = before.match(/\{\{\s*([a-z0-9_.]*)$/);
  if (meta) return { sigil: "{{", query: meta[1], start: caret - meta[0].length };
  const m = before.match(/(^|[\s(])([@#])([a-z0-9_]*)$/);
  if (!m) return null;
  return { sigil: m[2] as "@" | "#", query: m[3], start: caret - m[3].length - 1 };
}
