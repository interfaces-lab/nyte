import type { JobId, SessionId } from "./ids.ts";

/**
 * Returns one job as a row: command, owner session, terminal, state and tail.
 *
 * @category jobs
 * @since 0.1.0
 */
export type JobView = {
  readonly id: JobId;
  readonly command: string;
  readonly title: string;
  readonly session: SessionId | null;
  /** Present when the job runs in a pty: a workbench tab attaches to it like any terminal. */
  readonly pty: { readonly columns: number; readonly rows: number; readonly shell: string } | null;
  readonly state: JobState;
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** The last lines, bounded; a panel shows this without opening `output()`. */
  readonly tail: string;
};

/**
 * How a job stands: running, exited with a code, or lost with the host.
 *
 * @category jobs
 * @since 0.1.0
 */
export type JobState =
  | { readonly kind: "running" }
  | { readonly kind: "exited"; readonly code: number | null; readonly reason: EndReason }
  | { readonly kind: "lost" };

/**
 * How a job ended. The same record `settled()` resolves and `JobView.state` holds once it is final.
 *
 * @category jobs
 * @since 0.1.0
 */
export type JobEnd = Extract<JobState, { readonly kind: "exited" | "lost" }>;

/**
 * Why a process ended: on its own, killed, its lease expired, or the host went away.
 *
 * @category jobs
 * @since 0.1.0
 */
export type EndReason = "exited" | "terminated" | "expired" | "host-lost";

/**
 * Returns one frame of process output: bytes, a gap where a slow reader
 * missed some, or the exit code.
 *
 * @category jobs
 * @since 0.1.0
 */
export type OutputFrame =
  | { readonly kind: "bytes"; readonly data: Uint8Array }
  | { readonly kind: "gap" }
  | { readonly kind: "exit"; readonly code: number | null };
