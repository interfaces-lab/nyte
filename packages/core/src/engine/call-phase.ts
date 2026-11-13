import type { Json } from "@nyte-ai/schema";
import type { CallRecord } from "../contract/records.ts";

/**
 * Where a durable call stands. It is computed from a `CallRecord`'s `kind`, `result`, `waiting` and `waits` on every read and never stored, and this is the one place that says what each phase means and what recovery does with it.
 *
 * - `intended`: the model asked for a tool call and nothing opened it. An intent never carries a result, a wait or a park. Recovery runs a run's intents after its opened calls, in the order the model asked, reading the call from the intent (`owedCalls`); `runStep` opens one by replacing it with a tool record. A run's end deletes the intents it left.
 * - `opened`: a tool, hook or action record with no result that never parked. Its body may have run partway; what survives is its memos, clock readings and acquisitions. Recovery reruns the body, which answers from those.
 * - `parked`: waiting on `waiting`. Nothing runs it: recovery skips it, and every call that encloses it, until an outcome lands for its target and it becomes `woken`.
 * - `woken`: its last wait has an outcome and it has no result. Recovery reruns the body, and each `durable.wait` it reaches again answers from `waits`. A run's end drops its woken index entry.
 * - `settled`: it has a `result`, and every later run of it answers with that result without running the body.
 *
 * When `runStep` finds a call `opened`, `parked` or `woken` that this run of it did not open, and its `replay` is `never`, the call settles `interrupted` instead of running. A run's calls resume through `owedCalls`; an action's resume through `reserveRerun` when its wait wakes it.
 */
export type CallPhase =
  | { readonly kind: "intended" }
  | { readonly kind: "opened"; readonly replay: CallRecord["replay"] }
  | {
      readonly kind: "parked";
      readonly waiting: NonNullable<CallRecord["waiting"]>;
      readonly replay: CallRecord["replay"];
    }
  | { readonly kind: "woken"; readonly replay: CallRecord["replay"] }
  | { readonly kind: "settled"; readonly result: Json };

const INTENDED: CallPhase = { kind: "intended" };

export function callPhase(record: CallRecord): CallPhase {
  if (record.kind === "intent") return INTENDED;

  if (record.result !== null) return { kind: "settled", result: record.result };

  if (record.waiting !== null)
    return { kind: "parked", waiting: record.waiting, replay: record.replay };

  return record.waits.length === 0
    ? { kind: "opened", replay: record.replay }
    : { kind: "woken", replay: record.replay };
}
