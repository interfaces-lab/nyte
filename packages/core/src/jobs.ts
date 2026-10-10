import type { JobEnd, JobId, JobKey, JobView, OutputFrame, RequestOptions, SessionId, StopOutcome } from "@nyte-ai/schema";

/**
 * Starts, lists and watches a workspace's background processes.
 *
 * @category jobs
 * @since 0.1.0
 */
export interface Jobs {
  /**
   * Starts a process that outlives the caller: a background command, or an
   * interactive shell when `pty` is given.
   *
   * **Details**
   *
   * `session` is the session whose head the exit report attaches to; omit it
   * for a job nothing waits on (the terminal panel's dev server). Started
   * from an invocation, the report goes to the starting run's head;
   * otherwise to main.
   *
   * With `pty`, the job is a terminal: omitted `command` runs the configured
   * login shell, and the returned `Job` carries `key` for `recover`. No
   * arbitrary host cwd: a job runs in its workspace. Pass `id` only to retry
   * across your own restart; same id + same input returns the existing job.
   *
   * **Example** (Starting a dev server for a session)
   *
   * ```ts
   * declare const workspace: Workspace;
   * declare const session: Session;
   *
   * const job = await workspace.jobs.start({
   *   command: "pnpm dev",
   *   session: session.id,
   *   title: "Dev server",
   * });
   * for await (const frame of job.output()) {
   *   if (frame.kind === "exit") break;
   * }
   * ```
   *
   * @authority participant
   */
  start(input: { readonly command?: string; readonly session?: SessionId; readonly title?: string; readonly pty?: { readonly columns: number; readonly rows: number }; readonly id?: JobId }): Promise<Job>;
  /**
   * Reclaims a pty job by the key its handle carried, never a second shell;
   * or says it ended or is missing.
   *
   * @authority participant
   */
  recover(key: JobKey): Promise<Job | { readonly kind: "ended"; readonly end: JobEnd } | { readonly kind: "missing" }>;
  /**
   * Returns every job in the workspace.
   *
   * @authority participant
   */
  list(): Promise<readonly JobView[]>;
  /**
   * Yields the job list as it changes.
   *
   * @stream watch
   * @authority participant
   */
  watch(): AsyncIterable<readonly JobView[]>;
}

/**
 * Returns a handle on one job: stdin, output, stop and settlement.
 *
 * **Details**
 *
 * A job belongs to the workspace, not to a chat. It outlives the session
 * that started it, the tab that showed it and the client that asked: an
 * agent told to run a local server leaves a server running. Only `stop()`,
 * the process exiting or the host going away end it. On exit, if it has a
 * session, a bounded report (command, code, tail) attaches to that head; a
 * long-lived job streams nothing into the chat while it runs. A job is
 * background the moment nobody waits on it; a tool that waits uses
 * `wait({ kind: "job" })`.
 *
 * @category jobs
 * @since 0.1.0
 */
export interface Job {
  readonly id: JobId;
  /** Pass to `recover` to reclaim a pty job after a reconnect. Null for a pipe job. */
  readonly key: JobKey | null;
  /**
   * Writes stdin, for a pipe or a pty job. An MCP stdio server is a job; a
   * terminal's keystrokes are this. Volatile, never replayed.
   *
   * @authority participant
   */
  write(bytes: Uint8Array): Promise<void>;
  /**
   * Yields bytes, gaps and the exit.
   *
   * **Gotchas**
   *
   * A slow reader gets `gap`, never stalls the process.
   *
   * @stream frames
   * @authority participant
   */
  output(): AsyncIterable<OutputFrame>;
  /**
   * Resizes a pty job; answers `not-pty` for a pipe job.
   *
   * @authority participant
   */
  resize(size: { readonly columns: number; readonly rows: number }): Promise<{ readonly kind: "resized" } | { readonly kind: "not-pty" } | { readonly kind: "missing" }>;
  /**
   * Returns whether a pty job's shell is at a prompt, so stop needs no
   * confirmation. Answered by the pty driver (prompt markers), never by core.
   * False for a pipe job.
   *
   * @authority participant
   */
  idle(): Promise<boolean>;
  /**
   * Stops the process and awaits cleanup.
   *
   * @authority participant
   */
  stop(): Promise<StopOutcome<JobEnd>>;
  /**
   * Waits for the process to end.
   *
   * @authority participant
   */
  settled(options?: RequestOptions): Promise<JobEnd>;
  /**
   * Detaches this handle's output stream; the process keeps running.
   *
   * @authority participant
   */
  close(): Promise<void>;
  /** Detaches; for `await using`. */
  [Symbol.asyncDispose](): Promise<void>;
}
