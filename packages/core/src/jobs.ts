import type {
  CallId,
  Disposer,
  HeadName,
  JobEnd,
  JobId,
  JobKey,
  JobView,
  OutputFrame,
  RequestOptions,
  SessionId,
  StopOutcome,
  WorkspaceId,
} from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { ConnectionContext } from "./principals.ts";

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

/** Returns one job this process started: its row, its workspace, the key a pty job is recovered by, the process its environment's `exec` returned, the session and head its exit report and background item go to with the call that started it, and the digest of its start input, which a retry under the same id must match. */
export interface JobEntry {
  readonly view: JobView;
  readonly workspace: WorkspaceId;
  readonly key: JobKey | null;
  readonly process: Job;
  readonly owner: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly startedBy: CallId | null;
  } | null;
  readonly digest: string;
}

/** Holds the jobs this process started, in memory: jobs are not stored, so a restart loses them and an id the table does not hold reads `lost`. One per kernel (`kernel.jobs`), built on first use. */
export interface JobTable {
  /** Returns a job by id, or undefined when this process did not start it. */
  get(id: JobId): JobEntry | undefined;
  /** Returns the pty job a key names, or undefined. */
  byKey(key: JobKey): JobEntry | undefined;
  /** Returns a workspace's jobs in start order. */
  list(workspace: WorkspaceId): readonly JobEntry[];
  /** Records a started job and announces it as `update` does. */
  add(entry: JobEntry): void;
  /** Replaces a job's view with what `change` returns (a new tail, its end) and announces it: the workspace's listeners get its views, and a job with an owner publishes `background { item }` to the owning head (kind `job`, id and title the job's, `startedBy` the owner's call; `working` while running, `done` after a zero exit, `failed` after any other end). A job the table does not hold is ignored. */
  update(id: JobId, change: (view: JobView) => JobView): void;
  /** Calls the listener with a workspace's views, in start order, whenever one of its jobs is added or changes; the disposer stops it. */
  subscribe(workspace: WorkspaceId, listener: (views: readonly JobView[]) => void): Disposer;
}

/** Returns an empty job table over a kernel: what `kernel.jobs` holds, built on first use once the kernel object exists. */
export function createJobTable(kernel: Kernel): JobTable {
  throw new Error("not implemented");
}

/** Returns a workspace's jobs for a connection; each member checks participant authority. `start` takes its id from `input.id`, else, when the context's `origin` names a step, the acquisition recorded on that step keyed `acq:<n>` (§33a), else a fresh one; an id the table holds returns that job when the input's digest matches and throws `SdkError("invalid")` otherwise. Its owner is `input.session` with the origin's head when the origin runs in that session, else `main`, and the origin's call as `startedBy`; none without `input.session`. The process starts through `exec` of the environment of `input.session` or else the origin's session (`kernel.env`), else of the workspace's own (`attachWorkspace`), in the environment's `cwd`, with `pty` when given and no signal: a job outlives its caller. An omitted command runs the environment's login shell, as `exec([], { pty })`; without `pty` it throws `SdkError("invalid")`. A pty job gets a fresh `JobKey`. The table records the job; one reader of the process output keeps `tail` (the last 4 KiB, cut at a line start) and calls `endJob` when the process settles. `recover` returns the job a key names while it runs, `ended { end }` once it ended in this process, and `missing` otherwise. `list` reads the table; `watch` yields the views on every table change, coalesced. */
export function createJobs(
  kernel: Kernel,
  context: ConnectionContext,
  workspace: WorkspaceId,
): Jobs {
  throw new Error("not implemented");
}

/** Returns a handle on a job by id for a connection; binds synchronously, no I/O, and each member checks participant authority. `key` is the job's (null for a pipe job or an id the table does not hold). `write`, `output`, `resize`, `idle` and `settled` go to the process; `close` detaches this handle's open `output` streams and leaves the process running. `stop` stops the process, awaits `endJob` and answers `settled { outcome }` (also for a job already ended). For an id the table does not hold: `write` throws `SdkError("unknown")`, `output` yields `exit { code: null }`, `resize` answers `missing`, `idle` false, `stop` `missing` and `settled` `lost`. */
export function jobHandle(kernel: Kernel, context: ConnectionContext, id: JobId): Job {
  throw new Error("not implemented");
}

/** Ends a job this process started, once: sets its view's `state` to `end` and `endedAt` (`kernel.jobs.update`), then calls `kernel.waits.jobEnded(id, end)`. Unless a wait consumed the end, a job with an owner sends a bounded report (its command, how it ended, its tail; at most 4 KiB) to the owning head as `CORE_CONTEXT` with `source: { kind: "job", job }` and `delivery: "attach"`, exactly one of wake or attach as for a child report. What the table's output reader and `Job.stop` call. */
export function endJob(kernel: Kernel, id: JobId, end: JobEnd): Promise<void> {
  throw new Error("not implemented");
}
