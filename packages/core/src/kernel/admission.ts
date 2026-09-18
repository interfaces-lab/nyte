/**
 * What a head's latest run lets the queue land, and the one rule behind it:
 * only explicit user input starts model work. `step.ts` applies it to each
 * batch it would land; `sdk/wait.ts` applies it to the same batch of each
 * lane to tell a settled head from one the runner still has work on. One
 * policy and one batch rule, read in both places, so a waiter never sits on a
 * head the runner will touch and never spins on one it will not.
 */
import { isTerminalPhase, type Landing } from "@nyte-ai/protocol";
import type { Run } from "./model.ts";
import type { PendingChange } from "./queue.ts";

export type Admission =
  /** A run is in progress: the next batch joins it at a response boundary. */
  | { readonly kind: "live" }
  /** A stop is settling the live run: nothing lands until it ends `aborted`. */
  | { readonly kind: "settling" }
  /**
   * No run, or the last one ended, however it ended. Only a batch with user
   * input starts model work, as a new run. Configuration lands
   * without one; completed background work waits for that input and joins
   * its context.
   */
  | { readonly kind: "idle" };

export function admissionFor(run: Run | undefined): Admission {
  if (run === undefined || isTerminalPhase(run.phase)) return { kind: "idle" };
  return run.abortRequested === true ? { kind: "settling" } : { kind: "live" };
}

export function isUserInput(item: PendingChange): boolean {
  return item.change.body.kind === "message" && item.change.body.message.role === "user";
}

/** A landed change the model must answer, as opposed to configuration. */
export function startsResponse(item: PendingChange): boolean {
  return item.change.body.kind === "message" || item.change.body.kind === "completion";
}

/**
 * Whether `changes`, a batch or a lane's pending list, may land now. An idle
 * head admits a batch that carries user input, or one in which nothing would
 * make the model respond.
 */
export function admits(admission: Admission, changes: readonly PendingChange[]): boolean {
  if (changes.length === 0) return false;
  switch (admission.kind) {
    case "live":
      return true;
    case "settling":
      return false;
    case "idle":
      return changes.some(isUserInput) || !changes.some(startsResponse);
    default: {
      const _exhaustive: never = admission;
      return _exhaustive;
    }
  }
}

/**
 * The part of a lane one landing takes: through its first message under
 * `"one"`, all of it under `"all"`. Admission is judged on this batch, by the
 * runner and by a waiter alike, so both read the same answer from a lane.
 */
export function nextBatch(
  changes: readonly PendingChange[],
  drain: Landing["drain"],
): readonly PendingChange[] {
  if (drain === "all") return changes;
  const message = changes.findIndex((item) => item.change.body.kind === "message");
  return message === -1 ? changes : changes.slice(0, message + 1);
}

/**
 * Whether a runner with this `drain` would land some lane of `queued` on a
 * head whose latest run is `run`. Read by observers that must not disagree
 * with the runner: a waiter deciding the head is settled, a relocation
 * deciding it is quiet. Deferred completions on an idle head are neither.
 */
export function landsNow(
  run: Run | undefined,
  queued: readonly PendingChange[],
  drain: Landing["drain"],
): boolean {
  const admission = admissionFor(run);
  return [...Map.groupBy(queued, (item) => item.lane).values()].some((changes) =>
    admits(admission, nextBatch(changes, drain)),
  );
}
