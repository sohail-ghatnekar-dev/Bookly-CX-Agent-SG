// Small display helpers shared across pages.

// An AOP's display name, for places that only have its ID: "damaged_item" → "Damaged item".
export function aopTitle(name: string): string {
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// An ID for a new AOP, from the name typed for it: "Damaged items!" → "damaged_items".
export function aopId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "aop_$1").slice(0, 40);
}

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

// An AOP's text is its "Goal:" line (what it's used for, which the agent reads to pick it) and then its logic.
export function splitAop(body: string): { goal: string; logic: string } {
  const [first, ...rest] = body.split("\n");
  return { goal: first.replace(/^Goal:\s*/i, ""), logic: rest.join("\n") };
}

export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function joinAop(goal: string, logic: string): string {
  return `Goal: ${goal.trim().replace(/\s*\n\s*/g, " ")}\n${logic.trim()}`;
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
