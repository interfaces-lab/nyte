import type {
  CallId,
  HeadName,
  JobEnd,
  JobId,
  Json,
  MessageId,
  PartId,
  RunEnd,
  RunId,
  SessionId,
} from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { CallRecord } from "./records.ts";

/** Returns one parked durable wait: the step's call, where it runs (`head` null for an action or hook outside a head), and the whole target or combination it waits on. */
export interface ParkedWait {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly call: CallId;
  readonly target: NonNullable<CallRecord["waiting"]>;
}

/** Holds the durable waits parked in this process, by what wakes them. Each wake method finds the parked entries the event settles, records the `WaitOutcome` into their `CallRecord.waits` (`all` completes once every target has an outcome, `any` on the first), clears `waiting`, calls `kernel.wakes.notify(session, head)` so `advance` re-runs the step, and resolves whether anything woke. A head-less entry notifies no head; its step re-runs through the next `act`. */
export interface WaitRegistry {
  /** Parks a step on its target; a target already settled wakes it at once. */
  park(entry: ParkedWait): Promise<void>;
  /** Wakes the waits on a run that ended, with `run { end }`; `endRun` hands the answer to the child report. */
  runEnded(session: SessionId, run: RunId, end: RunEnd): Promise<boolean>;
  /** Wakes the waits on a job that ended, with `job { end }`. */
  jobEnded(job: JobId, end: JobEnd): Promise<boolean>;
  /** Wakes the waits on a part that was answered, with `part { answer }`. */
  partAnswered(
    part: PartId,
    answer: { readonly action: string; readonly input: Json },
  ): Promise<boolean>;
  /** Wakes the waits on a part that closed unanswered, with `part { answer: null }`. */
  partClosed(part: PartId): Promise<boolean>;
  /** Wakes the `untilInput` waits on a head that admitted a message, with `input { message }`. */
  inputAdmitted(session: SessionId, head: HeadName, message: MessageId): Promise<boolean>;
  /** Wakes every wait parked by a run that was stopped, with `stopped`. */
  runStopped(session: SessionId, run: RunId): Promise<boolean>;
  /** Fires the timers and deadlines due at `now`, with `timer` or `deadline`. */
  tick(now: number): Promise<boolean>;
  /** Returns the earliest timer or deadline among a head's parked waits, or null when none has one: what `advance` reports as `waiting { until }`. */
  nextDeadline(session: SessionId, head: HeadName): number | null;
}

/** Returns an empty wait registry over a kernel: what `kernel.waits` holds, built once the kernel object exists. */
export function createWaitRegistry(kernel: Kernel): WaitRegistry {
  throw new Error("not implemented");
}

/** Rebuilds `kernel.waits` after a restart from every `calls/*` record whose `waiting` is set; `cover` calls it. */
export function loadWaits(kernel: Kernel): Promise<void> {
  throw new Error("not implemented");
}
