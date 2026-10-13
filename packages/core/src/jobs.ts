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
import { dev } from "./dev-log.ts";
import { recordAcquisition, recordedAcquisition } from "./durable.ts";
import { waitFor } from "./waits.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { CORE_CONTEXT } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { MAIN, readSession } from "./session-state.ts";
import { closable, coalesce, latest } from "./watch.ts";

export interface Jobs {
  start(input: {
    readonly command?: string;
    readonly session?: SessionId;
    readonly title?: string;
    readonly pty?: { readonly columns: number; readonly rows: number };
    readonly id?: JobId;
  }): Promise<Job>;
  recover(
    key: JobKey,
  ): Promise<Job | { readonly kind: "ended"; readonly end: JobEnd } | { readonly kind: "missing" }>;
  list(): Promise<readonly JobView[]>;
  watch(): AsyncIterable<readonly JobView[]>;
}

export interface Job {
  readonly id: JobId;
  readonly key: JobKey | null;
  write(bytes: Uint8Array): Promise<void>;
  output(): AsyncIterable<OutputFrame>;
  resize(size: {
    readonly columns: number;
    readonly rows: number;
  }): Promise<
    { readonly kind: "resized" } | { readonly kind: "not-pty" } | { readonly kind: "missing" }
  >;
  idle(): Promise<boolean>;
  stop(): Promise<StopOutcome<JobEnd>>;
  settled(options?: RequestOptions): Promise<JobEnd>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

/** Returns one job this process started: its owner gets the exit report and the background item, and a retry under its id must match `digest`. */
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

/** Fans one process's output out to readers without ever stalling it, and keeps its last 4 KiB. A reader whose unread frames would pass 64 KiB reads one `gap` where it dropped bytes. */
export interface JobOutput {
  open(): { next(): Promise<IteratorResult<OutputFrame>>; close(): void };
  push(bytes: Uint8Array): void;
  gap(): void;
  end(code: number | null): void;
  tail(): string;
}

/** Holds the jobs this process started, in memory: a restart loses them, and an id the table does not hold reads `lost`. A change announces the workspace's views and publishes an owned job's `background` item unlogged when it changed. */
export interface JobTable {
  get(id: JobId): JobEntry | undefined;
  byKey(key: JobKey): JobEntry | undefined;
  list(workspace: WorkspaceId): readonly JobEntry[];
  /** Starts a job once per id: `spawn` adds it, and a start with the same digest while it spawns or runs awaits that one, another digest rejecting `invalid`. */
  start(id: JobId, digest: string, spawn: () => Promise<void>): Promise<void>;
  add(entry: JobEntry): void;
  update(id: JobId, change: (view: JobView) => JobView): void;
  subscribe(workspace: WorkspaceId, listener: (views: readonly JobView[]) => void): Disposer;
  background(
    session: SessionId,
  ): readonly { readonly head: HeadName; readonly item: BackgroundItem }[];
}

const TAIL_BYTES = 4096;

const READER_BYTES = 64 * 1024;

const REPORT_BYTES = 4096;

/** Returns an empty job table over a kernel. */
export function createJobTable(kernel: Kernel): JobTable {
  const entries = new Map<JobId, JobEntry>();
  const starts = new Map<JobId, { readonly digest: string; readonly started: Promise<void> }>();
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
    start(id, digest, spawn) {
      const pending = starts.get(id);
      const known = pending ?? entries.get(id);

      if (known !== undefined)
        return known.digest === digest
          ? (pending?.started ?? Promise.resolve())
          : Promise.reject(new SdkError("invalid", `Job ${id} was started with another input.`));
      const started = spawn().finally(() => starts.delete(id));
      starts.set(id, { digest, started });

      return started;
    },
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

/** Returns a workspace's jobs; a start from a step is an acquisition (`acquire`), so a re-run answers the recorded job, `lost` once this process no longer holds it (B F1). */
export function createJobs(
  kernel: Kernel,
  context: Pick<ConnectionContext, "origin">,
  workspace: WorkspaceId,
): Jobs {
  const views = (): readonly JobView[] => kernel.jobs.list(workspace).map((entry) => entry.view);

  return {
    start: (input) => startJob(kernel, context.origin, workspace, input),
    async recover(key) {
      const entry = kernel.jobs.byKey(key);

      if (entry === undefined || entry.workspace !== workspace) return { kind: "missing" };
      const state = entry.view.state;

      if (state.kind !== "running") return { kind: "ended", end: state };

      return jobHandle(kernel, entry.view.id);
    },
    list: async () => views(),
    watch() {
      return coalesce(latest(views(), (push) => kernel.jobs.subscribe(workspace, push)));
    },
  };
}

/** Returns a handle on a job by id; binds synchronously. For an id the table does not hold `output` throws `unavailable` as it is called, `write` throws `unknown`, `resize` and `stop` answer `missing` and `settled` `lost`. */
export function jobHandle(kernel: Kernel, id: JobId): Job {
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
      const entry = kernel.jobs.get(id);

      if (entry === undefined) throw new SdkError("unknown", `No job has the id ${id}.`);
      await entry.process.write(bytes);
    },
    output() {
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
      const entry = kernel.jobs.get(id);

      if (entry === undefined) return { kind: "missing" };
      const pty = entry.view.pty;

      if (pty === null) return { kind: "not-pty" };
      const outcome = await entry.process.resize(size);

      if (outcome.kind === "resized")
        kernel.jobs.update(id, (view) => ({ ...view, pty: { ...pty, ...size } }));

      return outcome;
    },
    async idle() {
      const entry = kernel.jobs.get(id);

      return entry === undefined || entry.view.pty === null ? false : entry.process.idle();
    },
    async stop() {
      const entry = kernel.jobs.get(id);

      if (entry === undefined) return { kind: "missing" };
      const state = entry.view.state;

      if (state.kind !== "running") return { kind: "settled", outcome: state };
      await entry.process.stop();

      return { kind: "settled", outcome: await settled() };
    },
    settled,
    close,
    [Symbol.asyncDispose]: close,
  };
}

/** Ends a job this process started, once: records its end, hands `exit` to its readers and offers the end to the waits. Unless a wait consumed or still holds it, an owned job attaches a bounded report (at most 4 KiB) to the owning head; a report the session no longer takes is dropped. */
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
  origin: ConnectionContext["origin"],
  workspace: WorkspaceId,
  input: Parameters<Jobs["start"]>[0],
): Promise<Job> {
  const digest = JSON.stringify([
    input.command ?? null,
    input.session ?? null,
    input.title ?? null,
    input.pty ?? null,
  ]);

  if (input.command === undefined && input.pty === undefined)
    throw new SdkError("invalid", "A job without a pty needs a command.");

  const held = (id: JobId): Job => {
    if ((kernel.jobs.get(id)?.digest ?? digest) !== digest)
      throw new SdkError("invalid", `Job ${id} was started with another input.`);

    return jobHandle(kernel, id);
  };

  const acquired = await acquire(kernel, origin, input.id, async () => ({
    id: input.id ?? asId<"job">(crypto.randomUUID()),
  }));

  if (acquired.kind === "recorded") return held(asId<"job">(acquired.id));
  const id = acquired.value.id;
  await kernel.jobs.start(id, digest, () => spawn(kernel, origin, workspace, input, id, digest));

  return jobHandle(kernel, id);
}

/** Starts a job's process through the environment of its session, else the origin's on this workspace, else the workspace's own, and adds it to the table. */
async function spawn(
  kernel: Kernel,
  origin: ConnectionContext["origin"],
  workspace: WorkspaceId,
  input: Parameters<Jobs["start"]>[0],
  id: JobId,
  digest: string,
): Promise<void> {
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
}

/** Runs a durable step's acquisition keyed `key`, else `acq:<n>`: what the step recorded, else `create()` recorded once; a loser to a concurrent run releases what it created and answers the winner's id. Outside a step it creates. Jobs and pages acquire through it. */
export async function acquire<T extends { readonly id: string }>(
  kernel: Kernel,
  step: {
    readonly session: SessionId;
    readonly call: CallId | null;
    readonly sequence: { next(): number };
  } | null,
  key: string | undefined,
  create: () => Promise<T>,
  release?: (lost: T) => Promise<void>,
): Promise<
  | { readonly kind: "recorded"; readonly id: string }
  | { readonly kind: "created"; readonly value: T }
> {
  if (step === null || step.call === null) return { kind: "created", value: await create() };
  const at = { session: step.session, call: step.call };
  const name = key ?? `acq:${step.sequence.next()}`;
  const recorded = await recordedAcquisition(kernel, at, name);

  if (typeof recorded === "string") return { kind: "recorded", id: recorded };
  const value = await create();
  const winner = await recordAcquisition(kernel, at, name, value.id);

  if (typeof winner !== "string" || winner === value.id) return { kind: "created", value };
  await release?.(value);

  return { kind: "recorded", id: winner };
}

/** Reads a process's output into its fan-out until it exits, then ends the job; never rejects. */
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

  await endJob(kernel, id, end).catch((error: unknown) => {
    dev("jobs", "end not recorded", { job: id, end: end.kind, error });
  });
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
