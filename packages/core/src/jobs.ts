import { asId, asSeq } from "@nyte-ai/schema";
import type {
  BackgroundItem,
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
import { send } from "./admission.ts";
import { recordAcquisition } from "./durable.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { CORE_CONTEXT, requireAuthority } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { MAIN, readSession } from "./session-state.ts";
import { waitFor } from "./waits.ts";
import { closable, coalesce, latest } from "./watch.ts";

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

/** Returns one job this process started: its row, its workspace, the key a pty job is recovered by, the process its environment's `exec` returned, the session and head its exit report and background item go to with the call that started it, the digest of its start input, which a retry under the same id must match, and the fan-out of its output. */
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
  readonly output: JobOutput;
}

/** Fans one process's output out to readers without ever stalling it, and keeps its tail. */
export interface JobOutput {
  /** Opens a reader: a `gap` when earlier output fell out of the kept tail, the kept tail, then every frame from now, `exit` last. A reader whose unread frames would pass 64 KiB drops bytes and reads one `gap` where it did. */
  open(): { next(): Promise<IteratorResult<OutputFrame>>; close(): void };
  /** Keeps bytes in the tail (the last 4 KiB) and hands them to every open reader. */
  push(bytes: Uint8Array): void;
  /** Marks a gap the process itself reported: every open reader reads one before its next bytes. */
  gap(): void;
  /** Hands `exit` to every open reader, after a `gap` to one that missed bytes, and ends them; later readers get the tail and `exit`. */
  end(code: number | null): void;
  /** Returns the kept tail as text, from its first whole line when earlier output was cut and a whole line follows the cut one. */
  tail(): string;
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
  /** Replaces a job's view with what `change` returns (a new tail, its end) and announces it: the workspace's listeners get its views, and a job with an owner publishes `background { item }` unlogged (seq 0, §37c) to the owning head when its item changed (kind `job`, id and title the job's, `startedBy` the owner's call; `working` while running, `done` after a zero exit, `failed` after any other end). A job the table does not hold is ignored. */
  update(id: JobId, change: (view: JobView) => JobView): void;
  /** Calls the listener with a workspace's views, in start order, whenever one of its jobs is added or changes; the disposer stops it. */
  subscribe(workspace: WorkspaceId, listener: (views: readonly JobView[]) => void): Disposer;
  /** Returns the background items of the jobs a session owns, each with its owning head: what a cold fold seeds after its log (§37c). */
  background(
    session: SessionId,
  ): readonly { readonly head: HeadName; readonly item: BackgroundItem }[];
}

const TAIL_BYTES = 4096;

const READER_BYTES = 64 * 1024;

const REPORT_BYTES = 4096;

/** Returns an empty job table over a kernel: what `kernel.jobs` holds, built on first use once the kernel object exists. */
export function createJobTable(kernel: Kernel): JobTable {
  const entries = new Map<JobId, JobEntry>();
  const listeners = new Map<WorkspaceId, Set<(views: readonly JobView[]) => void>>();

  const list = (workspace: WorkspaceId): readonly JobEntry[] =>
    [...entries.values()].filter((entry) => entry.workspace === workspace);

  const announce = (entry: JobEntry, previous: JobEntry | null): void => {
    const views = list(entry.workspace).map((known) => known.view);

    for (const listener of listeners.get(entry.workspace) ?? []) listener(views);
    const item = itemOf(entry);
    const before = previous === null ? null : itemOf(previous);

    if (entry.owner === null || item === null) return;

    if (before !== null && before.state === item.state && before.title === item.title) return;

    kernel.bus.publish(entry.owner.session, {
      seq: asSeq(0),
      at: Date.now(),
      head: entry.owner.head,
      kind: "background",
      item,
    });
  };

  return {
    get: (id) => entries.get(id),
    byKey: (key) => [...entries.values()].find((entry) => entry.key === key),
    list,
    add(entry) {
      entries.set(entry.view.id, entry);
      announce(entry, null);
    },
    update(id, change) {
      const previous = entries.get(id);

      if (previous === undefined) return;
      const next = { ...previous, view: change(previous.view) };
      entries.set(id, next);
      announce(next, previous);
    },
    subscribe(workspace, listener) {
      const known = listeners.get(workspace) ?? new Set<(views: readonly JobView[]) => void>();
      known.add(listener);
      listeners.set(workspace, known);

      return () => {
        known.delete(listener);

        if (known.size === 0 && listeners.get(workspace) === known) listeners.delete(workspace);
      };
    },
    background: (session) =>
      [...entries.values()].flatMap((entry) => {
        const item = itemOf(entry);

        return entry.owner?.session === session && item !== null
          ? [{ head: entry.owner.head, item }]
          : [];
      }),
  };
}

/** Returns a workspace's jobs for a connection; each member checks participant authority. `start` takes its id from `input.id`, else, when the context's `origin` names a step, the acquisition recorded on that step keyed `acq:<n>` (§33a), else a fresh one; an id the table holds returns that job when the input's digest matches and throws `SdkError("invalid")` otherwise. Its owner is `input.session` (which must be on this workspace, else `invalid`) with the origin's head when the origin runs in that session, else `main`, and the origin's call as `startedBy`; none without `input.session`. The process starts through `exec` of the environment of `input.session`, else of the origin's session when it is on this workspace (`kernel.env`), else of the workspace's own (`attachWorkspace`), in the environment's `cwd`, with `pty` when given and no signal: a job outlives its caller. An omitted command runs the environment's login shell, as `exec([], { pty })`; without `pty` it throws `SdkError("invalid")`. A pty job gets a fresh `JobKey`. The table records the job; one reader of the process output keeps `tail` (the last 4 KiB, cut at a line start), fans the output out, and calls `endJob` once the process settles. `recover` returns the job a key names in this workspace while it runs, `ended { end }` once it ended in this process, and `missing` otherwise. `list` reads the table; `watch` yields the views on every table change, coalesced. */
export function createJobs(
  kernel: Kernel,
  context: ConnectionContext,
  workspace: WorkspaceId,
): Jobs {
  const need = (operation: string): void =>
    requireAuthority(context.authority, "participant", `jobs.${operation}`);

  const views = (): readonly JobView[] => kernel.jobs.list(workspace).map((entry) => entry.view);

  return {
    async start(input) {
      need("start");

      return startJob(kernel, context, workspace, input);
    },
    async recover(key) {
      need("recover");
      const entry = kernel.jobs.byKey(key);

      if (entry === undefined || entry.workspace !== workspace) return { kind: "missing" };
      const state = entry.view.state;

      if (state.kind !== "running") return { kind: "ended", end: state };

      return jobHandle(kernel, context, entry.view.id);
    },
    async list() {
      need("list");

      return views();
    },
    watch() {
      need("watch");

      return coalesce(latest(views(), (push) => kernel.jobs.subscribe(workspace, push)));
    },
  };
}

/** Returns a handle on a job by id for a connection; binds synchronously, no I/O, and each member checks participant authority. `key` is the job's (null for a pipe job or an id the table does not hold). `write`, `resize` and `idle` go to the process (`not-pty` and false for a pipe job); `output` opens a reader of the job's output fan-out; `close` detaches this handle's open `output` streams and leaves the process running. `stop` stops the process, awaits `endJob` and answers `settled { outcome }` (also for a job already ended). `settled` waits until the table shows the job ended. For an id the table does not hold (one this instance never started, or another instance's, §42w): `write` throws `SdkError("unknown")`, `output` throws `SdkError("unavailable")` as it is called, before any stream opens, so a request for it fails (§42aa), `resize` answers `missing`, `idle` false, `stop` `missing` and `settled` `lost`. */
export function jobHandle(kernel: Kernel, context: ConnectionContext, id: JobId): Job {
  const need = (operation: string): void =>
    requireAuthority(context.authority, "participant", `job.${operation}`);

  const readers = new Set<() => void>();

  const settled = (options?: RequestOptions): Promise<JobEnd> =>
    waitFor({
      options,
      async check() {
        const entry = kernel.jobs.get(id);

        if (entry === undefined) return { value: { kind: "lost" } };
        const state = entry.view.state;

        return state.kind === "running" ? null : { value: state };
      },
      subscribe: (trigger) => {
        const workspace = kernel.jobs.get(id)?.workspace;

        return workspace === undefined ? () => {} : kernel.jobs.subscribe(workspace, trigger);
      },
    });

  const close = async (): Promise<void> => {
    for (const detach of readers) detach();
    readers.clear();
  };

  return {
    id,
    key: kernel.jobs.get(id)?.key ?? null,
    async write(bytes) {
      need("write");
      const entry = kernel.jobs.get(id);

      if (entry === undefined) throw new SdkError("unknown", `No job has the id ${id}.`);
      await entry.process.write(bytes);
    },
    output() {
      need("output");
      const entry = kernel.jobs.get(id);

      if (entry === undefined)
        throw new SdkError(
          "unavailable",
          `Job ${id} is not running in this host instance; its output reaches you through its exit report.`,
        );

      return closable<OutputFrame>(() => {
        const reader = entry.output.open();
        const detach = (): void => reader.close();
        readers.add(detach);

        return {
          pull: () => reader.next(),
          close() {
            readers.delete(detach);
            detach();
          },
        };
      });
    },
    async resize(size) {
      need("resize");
      const entry = kernel.jobs.get(id);

      if (entry === undefined) return { kind: "missing" };

      if (entry.view.pty === null) return { kind: "not-pty" };
      const outcome = await entry.process.resize(size);

      if (outcome.kind === "resized")
        kernel.jobs.update(id, (view) =>
          view.pty === null ? view : { ...view, pty: { ...view.pty, ...size } },
        );

      return outcome;
    },
    async idle() {
      need("idle");
      const entry = kernel.jobs.get(id);

      return entry === undefined || entry.view.pty === null ? false : entry.process.idle();
    },
    async stop() {
      need("stop");
      const entry = kernel.jobs.get(id);

      if (entry === undefined) return { kind: "missing" };
      const state = entry.view.state;

      if (state.kind !== "running") return { kind: "settled", outcome: state };
      await entry.process.stop();

      return { kind: "settled", outcome: await settled() };
    },
    async settled(options) {
      need("settled");

      return settled(options);
    },
    close,
    [Symbol.asyncDispose]: close,
  };
}

/** Ends a job this process started, once: sets its view's `state` to `end` and `endedAt` (`kernel.jobs.update`), hands `exit` to its readers, then calls `kernel.waits.jobEnded(id, end)`. Unless a wait consumed the end, a job with an owner sends a bounded report (its title and command, how it ended, its tail; at most 4 KiB) to the owning head as `CORE_CONTEXT` with `source: { kind: "job", job }` and `delivery: "attach"`, exactly one of wake or attach as for a child report; a report the session no longer takes is dropped. What the table's output reader calls once the process settles. */
export async function endJob(kernel: Kernel, id: JobId, end: JobEnd): Promise<void> {
  const entry = kernel.jobs.get(id);

  if (entry === undefined || entry.view.state.kind !== "running") return;

  kernel.jobs.update(id, (view) => ({
    ...view,
    state: end,
    endedAt: Date.now(),
    tail: entry.output.tail(),
  }));

  entry.output.end(end.kind === "exited" ? end.code : null);
  const consumed = await kernel.waits.jobEnded(id, end);
  const owner = entry.owner;

  if (consumed || owner === null) return;

  await send(kernel, {
    session: owner.session,
    head: owner.head,
    context: CORE_CONTEXT,
    content: report(entry.view, end, entry.output.tail()),
    options: { source: { kind: "job", job: id }, delivery: "attach" },
  }).catch(() => undefined);
}

async function startJob(
  kernel: Kernel,
  context: ConnectionContext,
  workspace: WorkspaceId,
  input: Parameters<Jobs["start"]>[0],
): Promise<Job> {
  const origin = context.origin;

  const digest = JSON.stringify([
    input.command ?? null,
    input.session ?? null,
    input.title ?? null,
    input.pty ?? null,
  ]);

  const minted = input.id ?? asId<"job">(crypto.randomUUID());

  const acquired =
    origin === null || origin.call === null
      ? minted
      : await recordAcquisition(
          kernel,
          { session: origin.session, call: origin.call },
          input.id ?? `acq:${origin.sequence.next()}`,
          minted,
        );

  const id = typeof acquired === "string" ? asId<"job">(acquired) : minted;
  const known = kernel.jobs.get(id);

  if (known !== undefined) {
    if (known.digest !== digest)
      throw new SdkError("invalid", `Job ${id} was started with another input.`);

    return jobHandle(kernel, context, id);
  }

  if (input.command === undefined && input.pty === undefined)
    throw new SdkError("invalid", "A job without a pty needs a command.");

  const on = async (session: SessionId): Promise<boolean> =>
    (await readSession(kernel, session))?.record.workspace === workspace;

  if (input.session !== undefined && !(await on(input.session)))
    throw new SdkError("invalid", `Session ${input.session} is not on workspace ${workspace}.`);

  const runner =
    input.session ?? (origin !== null && (await on(origin.session)) ? origin.session : null);

  const env =
    runner === null
      ? await kernel.environments.attachWorkspace(workspace)
      : await kernel.env(runner);

  const process = await env.exec(input.command ?? [], { cwd: env.cwd, pty: input.pty });
  const own = origin !== null && input.session !== undefined && origin.session === input.session;

  const owner =
    input.session === undefined
      ? null
      : {
          session: input.session,
          head: own && origin.head !== null ? origin.head : MAIN,
          startedBy: own ? origin.call : null,
        };

  const output = createOutput();

  kernel.jobs.add({
    view: {
      id,
      command: input.command ?? "",
      title: input.title ?? input.command ?? "Shell",
      session: input.session ?? null,
      pty: input.pty === undefined ? null : { ...input.pty, shell: input.command ?? "login" },
      state: { kind: "running" },
      startedAt: Date.now(),
      endedAt: null,
      tail: "",
    },
    workspace,
    key: input.pty === undefined ? null : asId<"job-key">(crypto.randomUUID()),
    process,
    owner,
    digest,
    output,
  });

  void pump(kernel, id, process, output);

  return jobHandle(kernel, context, id);
}

/** Reads a process's output into its fan-out and tail until it exits, then ends the job with how the process settled (`lost` when it cannot say). */
async function pump(kernel: Kernel, id: JobId, process: Job, output: JobOutput): Promise<void> {
  try {
    for await (const frame of process.output()) {
      if (frame.kind === "exit") break;

      if (frame.kind === "gap") {
        output.gap();

        continue;
      }

      output.push(frame.data);
      kernel.jobs.update(id, (view) => ({ ...view, tail: output.tail() }));
    }
  } catch {}

  const end = await process.settled().catch((): JobEnd => ({ kind: "lost" }));
  await endJob(kernel, id, end);
}

/** Returns an output fan-out with nothing read yet. */
function createOutput(): JobOutput {
  type Reader = { frames: OutputFrame[]; size: number; missed: boolean; wake: (() => void) | null };

  let kept = new Uint8Array(0);
  let cut = false;
  let exit: { readonly code: number | null } | null = null;
  const readers = new Set<Reader>();

  const wake = (reader: Reader): void => {
    const resolve = reader.wake;
    reader.wake = null;
    resolve?.();
  };

  return {
    open() {
      const reader: Reader = { frames: [], size: 0, missed: false, wake: null };
      let closed = false;

      if (cut) reader.frames.push({ kind: "gap" });

      if (kept.byteLength > 0) {
        reader.frames.push({ kind: "bytes", data: kept.slice() });
        reader.size += kept.byteLength;
      }

      if (exit === null) readers.add(reader);
      else reader.frames.push({ kind: "exit", code: exit.code });

      return {
        async next() {
          for (;;) {
            const frame = reader.frames.shift();

            if (frame !== undefined) {
              if (frame.kind === "bytes") reader.size -= frame.data.byteLength;

              return { done: false, value: frame };
            }

            if (closed || !readers.has(reader)) return { done: true, value: undefined };

            await new Promise<void>((resolve) => {
              reader.wake = resolve;
            });
          }
        },
        close() {
          closed = true;
          readers.delete(reader);
          wake(reader);
        },
      };
    },
    push(bytes) {
      const joined = new Uint8Array(kept.byteLength + bytes.byteLength);
      joined.set(kept);
      joined.set(bytes, kept.byteLength);

      if (joined.byteLength > TAIL_BYTES) cut = true;
      kept = joined.slice(Math.max(0, joined.byteLength - TAIL_BYTES));

      for (const reader of readers) {
        if (reader.size + bytes.byteLength > READER_BYTES) {
          reader.missed = true;

          continue;
        }

        if (reader.missed) reader.frames.push({ kind: "gap" });
        reader.missed = false;
        reader.frames.push({ kind: "bytes", data: bytes });
        reader.size += bytes.byteLength;
        wake(reader);
      }
    },
    gap() {
      cut = true;
      kept = new Uint8Array(0);

      for (const reader of readers) reader.missed = true;
    },
    end(code) {
      if (exit !== null) return;
      exit = { code };

      for (const reader of readers) {
        if (reader.missed) reader.frames.push({ kind: "gap" });
        reader.frames.push({ kind: "exit", code });
      }

      const ended = [...readers];
      readers.clear();

      for (const reader of ended) wake(reader);
    },
    tail() {
      const text = new TextDecoder().decode(kept);
      const first = text.indexOf("\n");

      return cut && first >= 0 && first < text.length - 1 ? text.slice(first + 1) : text;
    },
  };
}

/** Returns a job's background item, or null for a job without an owner. */
function itemOf(entry: JobEntry): BackgroundItem | null {
  if (entry.owner === null) return null;
  const state = entry.view.state;

  return {
    kind: "job",
    id: entry.view.id,
    title: entry.view.title,
    state:
      state.kind === "running"
        ? "working"
        : state.kind === "exited" && state.code === 0
          ? "done"
          : "failed",
    startedBy: entry.owner.startedBy,
  };
}

/** Returns a job's exit report: its title and command, how it ended, and as much of its tail as fits in 4 KiB. */
function report(view: JobView, end: JobEnd, tail: string): string {
  const how =
    end.kind === "lost"
      ? "was lost with the host"
      : end.reason === "exited"
        ? `exited with code ${end.code ?? "none"}`
        : `ended (${end.reason}) with code ${end.code ?? "none"}`;

  const title =
    view.command === ""
      ? `Job ${view.title} ${how}.`
      : `Job ${view.title} (${view.command}) ${how}.`;

  const room = REPORT_BYTES - new TextEncoder().encode(title).byteLength - 2;
  const bytes = new TextEncoder().encode(tail.trim());

  const kept =
    bytes.byteLength <= room ? bytes : bytes.subarray(bytes.byteLength - Math.max(0, room));

  const text = new TextDecoder().decode(kept);

  return text === "" ? title : `${title}\n\n${text}`;
}
