// The trace: every tool call and policy check in a turn, saved to Postgres and shown in the app.
import type { TraceEvent } from "./types.ts";

export type NewEvent = Omit<TraceEvent, "seq" | "ms" | "input" | "output" | "rule_id"> &
  Partial<Pick<TraceEvent, "ms" | "input" | "output" | "rule_id">>;

// Collects one turn's events. Raw input/output go to the DB only; clients get the short form.
export class Trace {
  readonly events: TraceEvent[] = [];

  constructor(private nextSeq: number) {}

  add(e: NewEvent): TraceEvent {
    const event: TraceEvent = {
      rule_id: null,
      ms: 0,
      input: null,
      output: null,
      ...e,
      seq: this.nextSeq++,
    };
    this.events.push(event);
    return event;
  }

  forClient() {
    return this.events.map(({ seq, kind, label, detail, outcome, rule_id, ms }) => ({
      seq,
      kind,
      label,
      detail,
      outcome,
      ...(rule_id ? { rule_id } : {}),
      ms,
    }));
  }

  rows(conversation_id: string, turn: number) {
    return this.events.map((e) => ({ conversation_id, turn, ...e }));
  }
}
