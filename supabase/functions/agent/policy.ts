// Return eligibility. Pure: no I/O, no clock. Both check_return_eligibility and
// initiate_return call this, so skipping the check can't change the outcome.

export type ReturnReason = "damaged_defective" | "changed_mind";

export interface ReturnInput {
  delivered_at: Date | null;
  format: "hardcover" | "paperback" | "ebook";
  status: "processing" | "shipped" | "delivered" | "cancelled";
  already_returned: boolean;
  reason: ReturnReason;
  now: Date;
}

export interface ReturnDecision {
  eligible: boolean;
  rule_id: string;
  days_since_delivery: number | null;
  window_days: number | null;
  message: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS: Record<ReturnReason, { days: number; rule_id: string }> = {
  changed_mind: { days: 30, rule_id: "RET-30" },
  damaged_defective: { days: 60, rule_id: "RET-60" },
};

export function evaluateReturn(input: ReturnInput): ReturnDecision {
  if (input.status !== "delivered" || !input.delivered_at) {
    return deny("RET-NOTDELIVERED", null, null, "not delivered yet");
  }
  const days = Math.floor((input.now.getTime() - input.delivered_at.getTime()) / DAY_MS);
  if (input.format === "ebook") {
    return deny("RET-DIGITAL", days, null, "ebooks not returnable");
  }
  if (input.already_returned) {
    return deny("RET-DUPLICATE", days, null, "return already exists for this item");
  }
  const window = WINDOWS[input.reason];
  if (days > window.days) {
    return deny(window.rule_id, days, window.days, `past ${window.days}-day window`);
  }
  return {
    eligible: true,
    rule_id: window.rule_id,
    days_since_delivery: days,
    window_days: window.days,
    message: `within ${window.days}-day window`,
  };
}

function deny(
  rule_id: string,
  days: number | null,
  window_days: number | null,
  message: string,
): ReturnDecision {
  return { eligible: false, rule_id, days_since_delivery: days, window_days, message };
}
