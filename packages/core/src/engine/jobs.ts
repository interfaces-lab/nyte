import { asId, asSeq, foldJobChange, SdkError } from "@nyte-ai/schema";
import type {
  BackgroundItem,
  CallId,
  JobChange,
  JobEnd,
  JobId,
  JobView,
  OutputFrame,
  RequestOptions,
  SessionId,
  WorkspaceId,
} from "@nyte-ai/schema";
import { CORE_CONTEXT } from "../contract/host.ts";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { Job, JobEntry, JobOutput, Jobs, JobTable } from "../contract/workspace.ts";
import { MAIN, readSession } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { closable } from "../util/iterable.ts";
import { send } from "./admission.ts";
import { recordAcquisition, recordedAcquisition } from "./durable.ts";
import { waitFor } from "./waits.ts";

const TAIL_BYTES = 4096;

const SCROLLBACK_BYTES = 256 * 1024;

const READER_BYTES = 64 * 1024;

const REPORT_BYTES = 4096;

const ENDED_KEPT = 32;

export function createJobTable(kernel: Kernel): JobTable {
  const entries = new Map<JobId, JobEntry>();
  const starts = new Map<JobId, { readonly digest: string; readonly started: Promise<void> }>();
  const listeners = new Map<WorkspaceId, Set<(change: JobChange) => void>>();

  const list = (workspace: WorkspaceId): readonly JobEntry[] =>
    [...entries.values()].filter((entry) => entry.workspace === workspace);

  const tell = (workspace: WorkspaceId, change: JobChange): void => {
    for (const listener of listeners.get(workspace) ?? []) listener(change);
  };

  const forgetEnded = (workspace: WorkspaceId): void => {
    const ended = list(workspace)
      .filter((entry) => entry.view.state.kind !== "running")
      .sort((left, right) => (left.view.endedAt ?? 0) - (right.view.endedAt ?? 0));

    for (const entry of ended.slice(0, Math.max(0, ended.length - ENDED_KEPT))) {
      entries.delete(entry.view.id);
      tell(workspace, { kind: "forgotten", id: entry.view.id });
    }
  };

  const announce = (entry: JobEntry, previous: JobEntry | null): void => {
    tell(entry.workspace, { kind: "job", job: entry.view });

    const item = createJobBackgroundItem(entry);
    const before = previous === null ? null : createJobBackgroundItem(previous);

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

      if (previous.view.state.kind === "running" && next.view.state.kind !== "running")
        forgetEnded(next.workspace);
    },
    subscribe(workspace, listener) {
      const known = listeners.get(workspace) ?? new Set<(change: JobChange) => void>();
      known.add(listener);
      listeners.set(workspace, known);

      return () => {
        known.delete(listener);

        if (known.size === 0 && listeners.get(workspace) === known) listeners.delete(workspace);
      };
    },
    background: (session) =>
      [...entries.values()].flatMap((entry) => {
        const item = createJobBackgroundItem(entry);

        return entry.owner?.session === session && item !== null
          ? [{ head: entry.owner.head, item }]
          : [];
      }),
  };
}

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
    watch: () => watchJobs(kernel, workspace),
  };
}

function watchJobs(kernel: Kernel, workspace: WorkspaceId): AsyncIterable<readonly JobView[]> {
  return closable<readonly JobView[]>(() => {
    let jobs: readonly JobView[] = kernel.jobs.list(workspace).map((entry) => entry.view);
    let opened = false;

    const moved = new Map<JobId, JobChange>();
    let wake: (() => void) | null = null;
    let closed = false;

    const unsubscribe = kernel.jobs.subscribe(workspace, (change) => {
      const id = change.kind === "job" ? change.job.id : change.id;
      moved.delete(id);
      moved.set(id, change);
      wake?.();
    });

    return {
      async pull() {
        if (!opened) {
          opened = true;

          return { done: false, value: jobs };
        }

        while (moved.size === 0 && !closed)
          await new Promise<void>((resolve) => {
            wake = resolve;
          });

        wake = null;
        const [first] = moved;

        if (first === undefined) return { done: true, value: undefined };
        moved.delete(first[0]);
        jobs = foldJobChange(jobs, first[1]);

        return { done: false, value: jobs };
      },
      close() {
        closed = true;
        unsubscribe();
        wake?.();
      },
    };
  });
}

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

async function endJob(kernel: Kernel, id: JobId, end: JobEnd): Promise<void> {
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

async function spawn(
  kernel: Kernel,
  origin: ConnectionContext["origin"],
  workspace: WorkspaceId,
  input: Parameters<Jobs["start"]>[0],
  id: JobId,
  digest: string,
): Promise<void> {
  const on = async (session: SessionId): Promise<boolean> =>
    (await readSession(kernel.store, session))?.record.workspace === workspace;

  if (input.session !== undefined && !(await on(input.session)))
    throw new SdkError("invalid", `Session ${input.session} is not on workspace ${workspace}.`);

  const runner =
    input.session ?? (origin !== null && (await on(origin.session)) ? origin.session : null);

  const env =
    runner === null
      ? await kernel.environments.attachWorkspace(workspace)
      : await kernel.environments.attach(runner);

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

  const output = createOutput(input.pty !== undefined && input.session === undefined);

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
  const recorded = await recordedAcquisition(kernel.store, at, name);

  if (typeof recorded === "string") return { kind: "recorded", id: recorded };
  const value = await create();
  const winner = await recordAcquisition(kernel, at, name, value.id);

  if (typeof winner !== "string" || winner === value.id) return { kind: "created", value };
  await release?.(value);

  return { kind: "recorded", id: winner };
}

/** Moves a job's process output into its readers, holding the next read while a flow-controlled output drains, until the process ends. */
async function pump(kernel: Kernel, id: JobId, process: Job, output: JobOutput): Promise<void> {
  const exited = process.settled().then(
    () => undefined,
    () => undefined,
  );

  try {
    for await (const frame of process.output()) {
      if (frame.kind === "exit") break;

      if (frame.kind === "gap") {
        output.gap();

        continue;
      }

      output.push(frame.data);
      kernel.jobs.update(id, (view) => ({ ...view, tail: output.tail() }));
      await Promise.race([output.drained(), exited]);
    }
  } catch {}

  const end = await process.settled().catch((): JobEnd => ({ kind: "lost" }));

  await endJob(kernel, id, end).catch((error: unknown) => {
    dev("jobs", "end not recorded", { job: id, end: end.kind, error });
  });
}

/**
 * A job's output for its readers: each reader opens on the last 256 KiB (the
 * scrollback a re-attached terminal shows) and then follows it live; the
 * view's tail is the last 4 KiB as text. A reader 64 KiB behind gets a gap,
 * unless the output is `flow`-controlled (a user's shell, which no session
 * owns): then it misses nothing, and `drained` holds the job's pump, and so
 * the pty, until the slowest reader is back under 64 KiB.
 */
function createOutput(flow: boolean): JobOutput {
  type Reader = {
    replay: OutputFrame[];
    frames: OutputFrame[];
    size: number;
    missed: boolean;
    wake: (() => void) | null;
  };

  let kept: Uint8Array[] = [];
  let size = 0;
  let cut = false;
  let exit: { readonly code: number | null } | null = null;
  const readers = new Set<Reader>();

  const draining = new Set<() => void>();

  const caughtUp = (): void => {
    if ([...readers].some((reader) => reader.size > READER_BYTES)) return;

    for (const resolve of draining) resolve();
    draining.clear();
  };

  const wake = (reader: Reader): void => {
    const resolve = reader.wake;
    reader.wake = null;
    resolve?.();
  };

  const last = (bytes: number): Uint8Array => {
    const out = new Uint8Array(Math.min(bytes, size));
    let end = out.byteLength;

    for (let index = kept.length - 1; index >= 0 && end > 0; index -= 1) {
      const chunk = kept[index] ?? new Uint8Array(0);
      const take = chunk.subarray(Math.max(0, chunk.byteLength - end));
      end -= take.byteLength;
      out.set(take, end);
    }

    return out;
  };

  return {
    open() {
      const replay: OutputFrame[] = cut ? [{ kind: "gap" }] : [];

      if (size > 0) replay.push({ kind: "bytes", data: last(size) });

      const reader: Reader = { replay, frames: [], size: 0, missed: false, wake: null };
      let closed = false;

      if (exit === null) readers.add(reader);
      else reader.frames.push({ kind: "exit", code: exit.code });

      return {
        async next() {
          for (;;) {
            const replayed = reader.replay.shift();

            if (replayed !== undefined) return { done: false, value: replayed };
            const frame = reader.frames.shift();

            if (frame !== undefined) {
              if (frame.kind === "bytes") reader.size -= frame.data.byteLength;
              caughtUp();

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
          caughtUp();
        },
      };
    },
    push(bytes) {
      kept.push(bytes);
      size += bytes.byteLength;

      while (size > SCROLLBACK_BYTES) {
        const first = kept[0];

        if (first === undefined) break;
        const over = size - SCROLLBACK_BYTES;
        cut = true;

        if (first.byteLength <= over) {
          kept.shift();
          size -= first.byteLength;
        } else {
          kept[0] = first.subarray(over);
          size -= over;
        }
      }

      for (const reader of readers) {
        if (!flow && reader.size + bytes.byteLength > READER_BYTES) {
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
    drained() {
      if ([...readers].every((reader) => reader.size <= READER_BYTES)) return Promise.resolve();

      return new Promise<void>((resolve) => draining.add(resolve));
    },
    gap() {
      cut = true;
      kept = [];
      size = 0;

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
      caughtUp();
    },
    tail() {
      const text = new TextDecoder().decode(last(TAIL_BYTES));

      return cut || size > TAIL_BYTES ? text.replace(/^[^\n]*\n(?=[\s\S])/, "") : text;
    },
  };
}

function createJobBackgroundItem(entry: JobEntry): BackgroundItem | null {
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
