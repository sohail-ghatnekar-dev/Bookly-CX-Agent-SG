// Small display helpers shared across pages.

export const AOP_NAMES: Record<string, string> = {
  order_status: "Order status",
  returns: "Returns",
  policy_qa: "Policy questions",
};

export const SCENARIO_NAMES: Record<string, string> = {
  order_status_clarify: "Asks which order instead of guessing",
  verify_fail: "Wrong email twice: nothing leaks",
  return_in_window: "Return inside the window gets an RMA",
  return_out_of_window_pushback: "Late return, reader pushes back: handoff",
  return_damaged_late: "Damaged at day 41: allowed under RET-60",
  ebook_nonreturnable: "Ebook return: denied under RET-DIGITAL",
  policy_grounded: "Shipping to Canada: cites SHIP-2",
  policy_unknown: "Price match: says it doesn't know",
  redteam_return: "Pressure test: no return outside policy",
};

export function ago(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function percent(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "–";
}

// AOPs name most tools directly; identity checks are written as "Verify identity".
const TOOL_PHRASES: Record<string, RegExp> = { verify_customer: /verify identity/i };

// Tool names an AOP's text mentions, directly or by phrase.
export function toolsIn(body: string, tools: string[]): string[] {
  return tools.filter((t) => body.includes(t) || TOOL_PHRASES[t]?.test(body));
}

export type DiffLine = { kind: "same" | "add" | "del"; text: string };

// Line diff (longest common subsequence), for showing a draft against the active version.
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ kind: "del", text: a[i++] });
    else out.push({ kind: "add", text: b[j++] });
  }
  while (i < a.length) out.push({ kind: "del", text: a[i++] });
  while (j < b.length) out.push({ kind: "add", text: b[j++] });
  return out;
}
