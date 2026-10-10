import type { BlobId, CommitId, JobId, RunId, SessionId } from "./ids.ts";

/**
 * Names when an admitted input runs.
 *
 * **Details**
 *
 * - `steer`: join the live run at its next boundary; start one if idle.
 * - `queue`: after the current run; start one if idle.
 * - `attach`: never starts a run; rides with whatever turn comes next.
 *
 * One admission path for users, core, tools and the terminal. Async subagent
 * reports, background job output and `!cmd` output are all attach by
 * default. A child asked to wake its parent sends with queue. Nothing else
 * waits.
 *
 * Core delivers a child's report: when a child's run ends, core attaches the
 * report to the parent head unless a durable wait on that run is parked, in
 * which case the wait wakes instead. Exactly one of the two; no plugin sends
 * it.
 *
 * @category heads
 * @since 0.1.0
 */
export type Delivery = "steer" | "queue" | "attach";

/**
 * Returns what a user sends: a string, or text, files and references.
 *
 * **Details**
 *
 * - `file`: any file: image, audio, video, pdf, source. From
 *   `files.upload`; never a local path.
 * - `reference`: an @mention. The host reads it at request time, so it is
 *   current, not a copy.
 *
 * **Gotchas**
 *
 * The model filters, not the sender. {@link ModelInfo.input} says what it
 * accepts; a file the model cannot take goes in as a text reference (name,
 * size, mime) rather than being refused.
 *
 * @category heads
 * @since 0.1.0
 */
export type UserContent =
  | string
  | readonly (
      | { readonly kind: "text"; readonly text: string }
      | { readonly kind: "file"; readonly blob: BlobId; readonly mime: string; readonly name: string }
      | { readonly kind: "reference"; readonly path: string }
    )[];

/**
 * Names a point in a head's history: the start, or a commit.
 *
 * @category heads
 * @since 0.1.0
 */
export type Position = { readonly kind: "start" } | { readonly kind: "commit"; readonly id: CommitId };

/**
 * Names who sent an input.
 *
 * **Details**
 *
 * - `shell`: `!cmd` run by the client.
 * - `action`: a button sent a prebuilt prompt. The client shows the label,
 *   never the content; not editable.
 *
 * @category heads
 * @since 0.1.0
 */
export type MessageSource =
  | { readonly kind: "user" }
  | { readonly kind: "child"; readonly session: SessionId }
  | { readonly kind: "job"; readonly job: JobId }
  | { readonly kind: "shell" }
  | { readonly kind: "action"; readonly label: string; readonly command?: string };

/**
 * Returns when a pending input will run.
 *
 * **Details**
 *
 * - `joined`: steer joined a live run at its next boundary.
 * - `next-turn`: waits for the next turn, for `reason`.
 * - `attached`: starts nothing; rides with the next turn.
 *
 * @category views
 * @since 0.1.0
 */
export type Schedule =
  | { readonly kind: "joined"; readonly run: RunId }
  | { readonly kind: "next-turn"; readonly reason: "requested" | "idle" | "run-ended" | "configuration" }
  | { readonly kind: "attached" };
