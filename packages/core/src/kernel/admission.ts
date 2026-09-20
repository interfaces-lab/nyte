/**
 * What a head's latest run lets the queue land. Explicit user input starts
 * model work. A delegate answer also starts it when the request record carries
 * an authorization from an un-stopped run; landing consumes that authorization
 * once. `step.ts` applies this rule to each batch it would land;
 * `sdk/wait.ts` applies it to the same batch of each lane to tell a settled
 * head from one the runner still has work on. One policy and one batch rule,
 * read in both places, so a waiter never sits on a head the runner will touch
 * and never spins on one it will not.
 */
import { isTerminalPhase, type Landing } from "@nyte-ai/protocol";
import { hasAuthorizedContinuation } from "./delegation-record.ts";
import type { Run } from "./model.ts";
import type { PendingChange } from "./queue.ts";
import type { Session } from "./store.ts";

export type Admission =
  /** A run is in progress: the next batch joins it at a response boundary. */
  | { readonly kind: "live" }
  /** A stop is settling the live run: nothing lands until it ends `aborted`. */
  | { readonly kind: "settling" }
  /**
   * No run, or the last one ended. A batch with user input starts model
   * work. The first response-starting change may instead be a delegate answer
   * whose request authorization is consumed by the landing CAS. Configuration
   * lands without model work; other completed work waits for input.
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

export function firstResponse(changes: readonly PendingChange[]): PendingChange | undefined {
  return changes.find(startsResponse);
}

/**
 * Whether `changes`, a batch or a lane's pending list, may land now. An idle
 * head admits a batch that carries user input, an authorized delegate answer,
 * or one in which nothing would make the model respond.
 */
export function admits(
  admission: Admission,
  changes: readonly PendingChange[],
  continuation: boolean,
): boolean {
  if (changes.length === 0) return false;
  switch (admission.kind) {
    case "live":
      return true;
    case "settling":
      return false;
    case "idle":
      return continuation || changes.some(isUserInput) || !changes.some(startsResponse);
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
 * with the runner. Unauthorized completions are not landable on an idle head;
 * authorized delegate answers are.
 */
export async function landsNow(
  session: Session,
  run: Run | undefined,
  queued: readonly PendingChange[],
  drain: Landing["drain"],
): Promise<boolean> {
  const admission = admissionFor(run);
  for (const changes of Map.groupBy(queued, (item) => item.lane).values()) {
    const batch = nextBatch(changes, drain);
    const starter = firstResponse(batch);
    const continuation =
      admission.kind === "idle" && starter !== undefined
        ? await hasAuthorizedContinuation(session, starter)
        : false;
    if (admits(admission, batch, continuation)) return true;
  }
  return false;
}
