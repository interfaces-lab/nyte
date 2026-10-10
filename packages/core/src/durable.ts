import type { CallId, HeadName, Json, PartId, RefUpdate, RunId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { CallRecord } from "./records.ts";
import type { Durable } from "./tools.ts";

/** Returns how a durable step ended: its body's value, parked on a wait not yet recorded, or interrupted because a `never` step may not run again. */
export type StepOutcome<T> =
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "parked" }
  | { readonly kind: "interrupted" };

/** What a durable step's `wait()` throws on its first wait not yet recorded, so the step unwinds and parks; a wake re-runs it. */
class Parked extends Error {
  constructor() {
    super("The durable step parked on a wait.");
  }
}

/** Returns whether an error is the sentinel a durable step's `wait()` throws to park it; whatever catches it inside a step rethrows it untouched. */
export function isParked(error: unknown): boolean {
  return error instanceof Parked;
}

/** Runs one durable step (a tool call, a part action or a decide hook) and returns how it ended. Creates the step's `CallRecord` with its intent, or loads it on a re-run. A record with a `result` returns `done` with `decode(result)` without running `body`; a result `decode` rejects throws `SdkError("internal")`. A record without a result under `replay: "never"` (parked, or the host died mid-step) is settled through `settle({ kind: "interrupted" })` and returns `interrupted`. Otherwise `body` runs with a `Durable` whose `wait()` replays recorded outcomes in call order and, on the first unrecorded wait, writes the whole target to `waiting` with `call waiting { on }` (and `run waiting { on }` when `run` is set), where `on` is the target itself or a composite's first unsettled target, parks the entry in `kernel.waits` and throws the parked sentinel; `memo(name, compute)` returns the recorded value or computes and records it, expecting the call ref's revision (a lost race re-reads the winner); `now()` returns the clock reading recorded at its call-order index, or records `Date.now()`. A step with no head (an action or hook outside one) parks without a head to notify; its wake re-runs it through the next `act`. When `body` resolves, the `result` that `settle` returns is recorded in one set with the updates it returns and the step returns `done`; a body that wrote `waiting` and resolved anyway (its own `catch` swallowed the sentinel) is `parked` and its value dropped; parking returns `parked`; any other throw is rethrown with nothing recorded. */
export function runStep<T>(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName | null;
    readonly run: RunId | null;
    readonly call: CallId;
    readonly kind: CallRecord["kind"];
    readonly replay: CallRecord["replay"];
    readonly intent: Json;
    readonly part: PartId | null;
    readonly signal: AbortSignal;
    body(durable: Durable): Promise<T>;
    /** Returns what the step's `result` records and the ref updates that land in the same set: for a tool, its part settled and the head commit. */
    settle(
      ended: Exclude<StepOutcome<T>, { readonly kind: "parked" }>,
    ): Promise<{ readonly result: Json; readonly updates: readonly RefUpdate[] }>;
    /** Returns the value a recorded `result` holds, or null when it holds another shape. */
    decode(result: Json): T | null;
  },
): Promise<StepOutcome<T>> {
  throw new Error("not implemented");
}

/** Records what a durable step acquired under a key (a session, part, job or browser id) unless one is recorded, and returns the recorded winner. `sessions.create`, `parts.create`, `jobs.start` and `browser.open` call it when their connection's `origin` names a step, keyed by `input.id ?? \`acq:${origin.sequence.next()}\``. */
export function recordAcquisition(
  kernel: Kernel,
  step: { readonly session: SessionId; readonly call: CallId },
  key: string,
  value: Json,
): Promise<Json> {
  throw new Error("not implemented");
}

/** Returns what a durable step recorded acquiring under a key, or null when it has acquired nothing under it; a re-run returns the recorded id instead of acquiring again. */
export function recordedAcquisition(
  kernel: Kernel,
  step: { readonly session: SessionId; readonly call: CallId },
  key: string,
): Promise<Json | null> {
  throw new Error("not implemented");
}
