import type { Configuration } from "./configuration.ts";
import type { CallId, HeadName, JobId, MessageId, PartId, RunId, SessionId } from "./ids.ts";
import type { Failure } from "./model/message.ts";
import type { Usage } from "./models.ts";

/**
 * Returns a run's fixed metadata: head, start, attempt, configuration and
 * origin.
 *
 * **Details**
 *
 * No phase here: {@link Execution} on the view is the one place a run's
 * phase lives.
 *
 * @category runs
 * @since 0.1.0
 */
export interface RunView {
  readonly id: RunId;
  readonly head: HeadName;
  readonly startedAt: number;
  /** Provider retries; parts carry it in their ids. */
  readonly attempt: number;
  readonly configuration: Configuration;
  /** What started it. */
  readonly origin: { readonly kind: "input"; readonly message: MessageId } | { readonly kind: "continuation"; readonly from: "child" | "job" | "wake" };
}

/**
 * Returns how a run ended.
 *
 * **Outcomes**
 *
 * - `completed`: the model finished; `usage` is the run's total.
 * - `stopped`: a stop reached it.
 * - `failed`: `failure` says why, after the provider retry policy.
 *
 * @category runs
 * @since 0.1.0
 */
export type RunEnd =
  | { readonly kind: "completed"; readonly usage: Usage }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly failure: Failure };

/**
 * Returns a head's run phase: the one place it lives.
 *
 * **Details**
 *
 * - `idle`: nothing running; `lastRun` says how the last run ended, so a
 *   sidebar row says finished, stopped or failed without opening the
 *   session.
 * - `live`: responding or executing; `stopping` once the fence is passed.
 * - `waiting`: parked on a durable wait.
 * - `retrying`: a provider retry is scheduled `at`.
 *
 * @category views
 * @since 0.1.0
 */
export type Execution =
  | { readonly kind: "idle"; readonly lastRun: { readonly id: RunId; readonly end: RunEnd; readonly endedAt: number } | null }
  | { readonly kind: "live"; readonly run: RunView; readonly phase: "responding" | "executing"; readonly stopping: boolean }
  | { readonly kind: "waiting"; readonly run: RunView; readonly on: WaitTarget }
  | { readonly kind: "retrying"; readonly run: RunView; readonly until: number; readonly reason: string };

/**
 * Returns one child, job or page working in the background for a head.
 *
 * @category views
 * @since 0.1.0
 */
export interface BackgroundItem {
  readonly kind: "child" | "job" | "page";
  readonly id: string;
  readonly title: string;
  readonly state: "working" | "waiting" | "done" | "failed";
  /** The tool call that started it, if any. */
  readonly startedBy: CallId | null;
}

/**
 * Names what a durable wait parks on, with an optional deadline.
 *
 * **Details**
 *
 * - `run`: a sync subagent's run.
 * - `job`: a job's exit.
 * - `part`: a modal part; an action settles it.
 * - `timer`: a point in time.
 *
 * @category durability
 * @since 0.1.0
 */
export type WaitTarget = { readonly deadline?: number } & (
  | { readonly kind: "run"; readonly session: SessionId; readonly run: RunId }
  | { readonly kind: "job"; readonly job: JobId }
  | { readonly kind: "part"; readonly part: PartId }
  | { readonly kind: "timer"; readonly until: number }
);
