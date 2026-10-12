import { asId } from "@nyte-ai/schema";
import type {
  Activation,
  AddOutcome,
  Capability,
  ChangeSet,
  DiffOptions,
  EnvironmentIdentity,
  FileStatus,
  ForgetOutcome,
  JobId,
  PatchEntry,
  PatchSet,
  ReceiptId,
  RunId,
  SessionId,
  SnapshotId,
  WorkspaceId,
  WorkspaceInfo,
  WorkspaceInspection,
  WorkspaceTarget,
} from "@nyte-ai/schema";
import type { BrowserApi, PageHolder } from "./browser.ts";
import { UnavailableError, availabilityOf, readWorkspace } from "./environment.ts";
import type { Resources, SnapshotsApi } from "./environment.ts";
import { SdkError } from "./error.ts";
import type { FilesApi, HeldBatch } from "./files.ts";
import type { GitApi } from "./git.ts";
import { createJobs, jobHandle } from "./jobs.ts";
import type { Job, Jobs } from "./jobs.ts";
import type { Kernel } from "./kernel.ts";
import { sessionPlugins } from "./plugin-runtime.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import type { ConnectionContext } from "./principals.ts";
import { decodeRunRecord, decodeSessionRecord, decodeWorkspaceRecord } from "./records.ts";
import type { WorkspaceRecord } from "./records.ts";
import { runRef, workspaceRef } from "./refs.ts";
import { invalidateResources } from "./resources.ts";
import {
  MAIN,
  STALE,
  isCovered,
  attempt,
  commit,
  liveRuns,
  load,
  put,
  readSession,
  requireSession,
} from "./session-state.ts";
import { closable, coalesce, latest } from "./watch.ts";

export interface Workspaces {
  list(): Promise<readonly WorkspaceInfo[]>;
  inspect(target: WorkspaceTarget): Promise<WorkspaceInspection>;
  add(
    target: WorkspaceTarget,
    options?: {
      readonly projectResources?: boolean;
      readonly expect?: { readonly identity: EnvironmentIdentity };
    },
  ): Promise<AddOutcome>;
  forget(id: WorkspaceId): Promise<ForgetOutcome>;
}

export interface Workspace {
  readonly id: WorkspaceId;
  info(): Promise<WorkspaceInfo>;
  watch(): AsyncIterable<WorkspaceInfo>;
  update(patch: {
    readonly projectResources?: boolean;
  }): Promise<{ readonly kind: "updated" } | { readonly kind: "missing" }>;
  reload(): Promise<{ readonly kind: "updated" } | { readonly kind: "missing" }>;
  readonly jobs: Jobs;
  job(id: JobId): Job;
  changes(run: RunId): Promise<ChangeSet>;
  patches(run: RunId, paths: readonly string[], options?: DiffOptions): AsyncIterable<PatchSet>;
  files(): Promise<Capability<FilesApi>>;
  git(): Promise<Capability<GitApi>>;
  browser(): Promise<Capability<BrowserApi>>;
}

/** Returns one path's patch: `fresh` false while it is the previous revision's. */
type HeldEntry = PatchEntry & { readonly fresh: boolean };

/** Returns one path's read at a revision; `value` null when the revision does not report the path. */
type PatchSlot = {
  done: boolean;
  value: HeldEntry | null;
  readonly read: Promise<HeldEntry | null>;
};

/** Returns the patch cache of one run under one set of diff options. */
type PatchCache = { readonly revision: SnapshotId; readonly slots: Map<string, PatchSlot> };

const PATCH_READ_MAX = 32;

const PATCH_READS = 4;

const staleEntries = new WeakMap<HeldEntry, HeldEntry>();

/** Holds a kernel's workspace-side memory (§52): `Workspace.watch` listeners, patch reads, session scans, the home's files and file batches. */
export interface WorkspaceState {
  readonly listeners: Set<(id: WorkspaceId) => void>;
  readonly patches: Map<string, PatchCache>;
  readonly scans: Map<
    SessionId,
    { readonly workspace: WorkspaceId; readonly resources: Promise<Resources> }
  >;
  home: Promise<FilesApi | null> | null;
  readonly batches: Map<ReceiptId, AbortController>;
  readonly held: Map<ReceiptId, HeldBatch>;
}

/** Returns an empty workspace state, what `createKernel` puts on `kernel.workspaceState`. */
export function createWorkspaceState(): WorkspaceState {
  return {
    listeners: new Set(),
    patches: new Map(),
    scans: new Map(),
    home: null,
    batches: new Map(),
    held: new Map(),
  };
}

const ACTIVE: Activation = { kind: "active" };

const INACTIVE: Activation = { kind: "inactive" };

/** Returns the workspaces registered on this host; `add` records `context.principal` as `addedBy`. */
export function createWorkspaces(
  kernel: Kernel,
  context: Pick<ConnectionContext, "principal">,
): Workspaces {
  return {
    async list() {
      const records = await workspaceRecords(kernel);
      const infos = await Promise.all(records.map((record) => workspaceInfo(kernel, record.id)));

      return infos.flatMap((info) => (info === null ? [] : [info]));
    },
    async inspect(target) {
      const provider = kernel.environments.provider(target.kind);

      if (provider === undefined)
        throw new SdkError("unavailable", `No environment provider serves ${target.kind}.`);
      const inspected = await provider.inspect(target);
      const registered = await byIdentity(kernel, inspected.identity);

      return {
        target,
        identity: inspected.identity,
        availability: inspected.availability,
        projectSources: inspected.projectSources,
        registered: registered?.id ?? null,
      };
    },
    async add(target, options) {
      const provider = kernel.environments.provider(target.kind);

      if (provider === undefined) return { kind: "unavailable", reason: "unsupported" };
      const inspected = await provider.inspect(target).catch(() => null);

      if (inspected === null) return { kind: "unavailable", reason: "unreachable" };

      if (inspected.availability.kind === "unavailable")
        return { kind: "unavailable", reason: inspected.availability.reason };

      if (options?.expect !== undefined && options.expect.identity !== inspected.identity)
        return { kind: "stale", identity: inspected.identity };
      const existing = await byIdentity(kernel, inspected.identity);

      if (existing !== null) return { kind: "exists", workspace: existing.id };
      const id = asId<"workspace">(crypto.randomUUID());

      const record: WorkspaceRecord = {
        id,
        target,
        identity: inspected.identity,
        projectResources: options?.projectResources ?? true,
        projectSources: inspected.projectSources,
        addedBy: context.principal,
        createdAt: Date.now(),
      };

      const outcome = await commit(kernel, [
        {
          name: workspaceRef(id),
          target: await put(kernel, "workspace", record),
          expect: "absent",
        },
      ]);

      if (outcome.kind === "stale") throw new SdkError("stale", `Workspace ${id} already exists.`);
      changed(kernel, id);

      return { kind: "added", workspace: id };
    },
    async forget(id) {
      return attempt<ForgetOutcome>(`Forgetting ${id}`, async () => {
        const ref = await kernel.store.refs.get(workspaceRef(id));

        if (ref === null) return { kind: "missing" };
        const sessions = await sessionsOn(kernel, id);

        if (sessions.length > 0) return { kind: "busy", sessions };

        const outcome = await commit(kernel, [
          { name: workspaceRef(id), target: null, expect: ref.revision },
        ]);

        if (outcome.kind === "stale") return STALE;
        await kernel.environments.detachWorkspace(id);
        invalidateResources(kernel, id);
        changed(kernel, id);

        return { kind: "forgotten" };
      });
    },
  };
}

/** Returns a handle on a workspace; binds synchronously. An origin in a session on this workspace views it through the session's environment (§37f), and pages opened through `browser()` are held by the origin's head (§37i). */
export function workspaceHandle(
  kernel: Kernel,
  context: Pick<ConnectionContext, "origin">,
  id: WorkspaceId,
): Workspace {
  const viewing = async (): Promise<SessionId | null> => {
    const origin = context.origin;

    if (origin === null) return null;

    return (await readSession(kernel, origin.session))?.record.workspace === id
      ? origin.session
      : null;
  };

  const snapshots = async (): Promise<SnapshotsApi> => {
    const session = await viewing();

    const found =
      session === null
        ? await kernel.environments.workspaceSnapshots(id)
        : await kernel.snapshots(session);

    if (found === null)
      throw new SdkError("unavailable", `Workspace ${id} takes no run snapshots.`);

    return found;
  };

  const origin = context.origin;

  const holder: PageHolder | null =
    origin === null
      ? null
      : {
          session: origin.session,
          head: origin.head ?? MAIN,
          call: origin.call,
          sequence: origin.sequence,
        };

  const capabilities = async () => {
    const session = await viewing();

    return session === null
      ? kernel.environments.workspaceCapabilities(id, holder)
      : kernel.environments.capabilities(session, holder);
  };

  const rewrite = (what: string, change: (record: WorkspaceRecord) => WorkspaceRecord) =>
    attempt<{ readonly kind: "updated" } | { readonly kind: "missing" }>(what, async () => {
      const found = await load(
        kernel,
        await kernel.store.refs.get(workspaceRef(id)),
        decodeWorkspaceRecord,
      );

      if (found === null) return { kind: "missing" };

      const outcome = await commit(kernel, [
        {
          name: workspaceRef(id),
          target: await put(kernel, "workspace", change(found.record)),
          expect: found.ref.revision,
        },
      ]);

      return outcome.kind === "set" ? { kind: "updated" } : STALE;
    });

  return {
    id,
    async info() {
      const info = await workspaceInfo(kernel, id);

      if (info === null) throw new SdkError("unknown", `Workspace ${id} is not registered.`);

      return info;
    },
    watch() {
      return closable<WorkspaceInfo>(() => {
        let changes = 0;
        let shown: string | null = null;

        const ticks = coalesce(
          latest(changes, (push) => {
            const bump = (): void => {
              changes += 1;
              push(changes);
            };

            const listener = (changed: WorkspaceId): void => {
              if (changed === id) bump();
            };

            kernel.workspaceState.listeners.add(listener);

            const stopSessions = kernel.bus.subscribeAll((_session, event) => {
              if (event.kind === "session" || event.kind === "run") bump();
            });

            return () => {
              kernel.workspaceState.listeners.delete(listener);
              stopSessions();
            };
          }),
        )[Symbol.asyncIterator]();

        return {
          async pull() {
            for (;;) {
              const tick = await ticks.next();

              if (tick.done) return tick;
              const info = await workspaceInfo(kernel, id);

              if (info === null) return { done: true, value: undefined };
              const key = JSON.stringify(info);

              if (key === shown) continue;
              shown = key;

              return { done: false, value: info };
            }
          },
          close() {
            void ticks.return?.();
          },
        };
      });
    },
    async update(patch) {
      const outcome = await rewrite(`Updating ${id}`, (record) => ({
        ...record,
        projectResources: patch.projectResources ?? record.projectResources,
      }));

      if (outcome.kind === "updated") {
        invalidateResources(kernel, id);
        changed(kernel, id);
      }

      return outcome;
    },
    async reload() {
      if ((await readWorkspace(kernel, id)) === null) return { kind: "missing" };
      invalidateResources(kernel, id);
      await kernel.environments.detachWorkspace(id);

      for (const session of await sessionsOn(kernel, id)) {
        if (kernel.activation(session).kind !== "active") await kernel.environments.detach(session);
        await Promise.allSettled([kernel.reloadPlugins(session)]);
      }

      changed(kernel, id);

      return { kind: "updated" };
    },
    jobs: createJobs(kernel, context, id),
    job: (job) => jobHandle(kernel, job),
    async changes(run) {
      const found = await snapshots();
      const from = (await runStart(kernel, id, run)) ?? (await found.before(run));

      return found.diff(from, await found.after(run));
    },
    patches(run, paths, options) {
      return patchesOf(kernel, { workspace: id, run, paths, options, snapshots });
    },
    files: async () => (await capabilities()).files,
    git: async () => (await capabilities()).git,
    browser: async () => (await capabilities()).browser,
  };
}

/** Runs a session's activation over its new runtime: what `ready` settles with (§44a); an unknown session rejects `unknown`. The environment attaches once and the activation is derived from that one settled attach, which the plugins share (E7). */
export async function activateSession(
  kernel: Kernel,
  session: SessionId,
  runtime: PluginRuntime,
): Promise<void> {
  const workspace = (await requireSession(kernel, session)).record.workspace;

  const attached = (await isCovered(kernel, session))
    ? kernel.env(session).then(
        () => ACTIVE,
        (error: unknown) => activationOf(workspace, error),
      )
    : INACTIVE;

  try {
    await runtime.load(sessionPlugins(kernel, runtime));
  } catch (error) {
    settle(kernel, session, workspace, activationOf(workspace, error));

    throw error;
  }

  settle(kernel, session, workspace, await attached);
}

/** Returns a registered workspace's record with its live fields, or null. */
export async function workspaceInfo(
  kernel: Kernel,
  id: WorkspaceId,
): Promise<WorkspaceInfo | null> {
  const record = await readWorkspace(kernel, id);

  if (record === null) return null;

  const [availability, sessions] = await Promise.all([
    availabilityOf(kernel, record.target),
    sessionsOn(kernel, id),
  ]);

  const runs = await Promise.all(sessions.map((session) => liveRuns(kernel, session)));

  return {
    id,
    target: record.target,
    identity: record.identity,
    availability,
    projectResources: record.projectResources,
    projectSources: record.projectSources,
    addedBy: record.addedBy,
    sessions: sessions.length,
    writers: runs.flat().map((run) => run.record.view.id),
  };
}

/** Returns the sessions whose records name a workspace. */
export async function sessionsOn(
  kernel: Kernel,
  workspace: WorkspaceId,
): Promise<readonly SessionId[]> {
  const refs = await kernel.store.refs.list("sessions/");

  const records = await Promise.all(
    refs.map(async (ref) =>
      ref.name.split("/").length !== 2 || ref.target === null
        ? null
        : decodeSessionRecord(await kernel.store.objects.get(ref.target)),
    ),
  );

  return records.flatMap((record) =>
    record !== null && record.workspace === workspace ? [record.id] : [],
  );
}

/** Sets a session's activation when it changed and announces it on the workspace bus. */
function settle(
  kernel: Kernel,
  session: SessionId,
  workspace: WorkspaceId,
  activation: Activation,
): void {
  if (JSON.stringify(kernel.activation(session)) === JSON.stringify(activation)) return;
  kernel.setActivation(session, activation);
  changed(kernel, workspace);
}

function activationOf(workspace: WorkspaceId, error: unknown): Activation {
  return error instanceof UnavailableError
    ? { kind: "unavailable", workspace, reason: error.reason }
    : { kind: "failed", message: error instanceof Error ? error.message : String(error) };
}

/** Yields a run's patches for `paths` as full `PatchSet`s over one revision, read in batches of at most 32, 4 in flight, and cached by workspace, run, options, revision and path; a failed batch yields its paths as `failed` and stays uncached, and the previous revision's entries are held `fresh: false` until their fresh reads land. */
async function* patchesOf(
  kernel: Kernel,
  input: {
    readonly workspace: WorkspaceId;
    readonly run: RunId;
    readonly paths: readonly string[];
    readonly options: DiffOptions | undefined;
    snapshots(): Promise<SnapshotsApi>;
  },
): AsyncGenerator<PatchSet> {
  const { run, options } = input;
  const snapshots = await input.snapshots();
  const from = (await runStart(kernel, input.workspace, run)) ?? (await snapshots.before(run));
  const to = await snapshots.after(run);
  let statuses: Promise<ReadonlyMap<string, FileStatus> | null> | null = null;

  const statusesOf = (): Promise<ReadonlyMap<string, FileStatus> | null> => {
    statuses ??= snapshots.diff(from, to).then(
      (changes) => new Map(changes.files.map((file) => [file.path, file.status])),
      () => null,
    );

    return statuses;
  };

  const caches = kernel.workspaceState.patches;
  const key = JSON.stringify([input.workspace, run, options?.ignoreWhitespace === true]);
  const previous = caches.get(key);

  const current: PatchCache =
    previous?.revision === to ? previous : { revision: to, slots: new Map() };

  caches.set(key, current);
  const held = previous === current ? null : (previous ?? null);
  const paths = [...new Set(input.paths)];
  const unread = paths.filter((path) => !current.slots.has(path));
  const limit = limiter(PATCH_READS);
  const mine = new Map<string, PatchSlot>();

  for (let start = 0; start < unread.length; start += PATCH_READ_MAX) {
    const batch = unread.slice(start, start + PATCH_READ_MAX);
    const read = limit(() => snapshots.patches(from, to, batch, options));

    for (const path of batch) {
      const slot: PatchSlot = {
        done: false,
        value: null,
        read: read.then(
          (entries) => {
            const entry = entries.find((candidate) => candidate.path === path);
            slot.value = entry === undefined ? null : { ...entry, fresh: true };
            slot.done = true;

            return slot.value;
          },
          async (error: unknown) => {
            if (current.slots.get(path) === slot) current.slots.delete(path);
            const known = await statusesOf();
            const status = known === null ? "modified" : known.get(path);

            slot.value =
              status === undefined
                ? null
                : {
                    path,
                    status,
                    digest: "",
                    kind: "failed",
                    reason: error instanceof Error ? error.message : String(error),
                    fresh: true,
                  };
            slot.done = true;

            return slot.value;
          },
        ),
      };

      current.slots.set(path, slot);
    }
  }

  for (const path of paths) {
    const slot = current.slots.get(path);

    if (slot !== undefined) mine.set(path, slot);
  }

  const view = (): PatchSet => {
    const entries = new Map<string, HeldEntry>();

    for (const path of paths) {
      const slot = mine.get(path);

      if (slot?.done === true) {
        if (slot.value !== null) entries.set(path, slot.value);

        continue;
      }

      const old = held?.slots.get(path);

      if (old?.done === true && old.value !== null) entries.set(path, staleOf(old.value));
    }

    return { revision: to, entries };
  };

  let pending = [...mine.values()].filter((slot) => !slot.done);

  const first = view();

  if (pending.length === 0 || first.entries.size > 0) yield first;

  while (pending.length > 0) {
    await Promise.race(pending.map((slot) => slot.read));
    pending = pending.filter((slot) => !slot.done);

    yield view();
  }
}

/** Returns a held entry marked `fresh: false`, the same object for the same entry. */
function staleOf(entry: HeldEntry): HeldEntry {
  const known = staleEntries.get(entry);

  if (known !== undefined) return known;
  const stale = { ...entry, fresh: false };
  staleEntries.set(entry, stale);

  return stale;
}

/** Returns a runner that starts at most `size` pieces of work at once. */
function limiter(size: number): <T>(work: () => Promise<T>) => Promise<T> {
  let active = 0;
  const queue: (() => void)[] = [];

  return (work) =>
    new Promise((resolve, reject) => {
      const run = (): void => {
        active += 1;

        work()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            queue.shift()?.();
          });
      };

      if (active < size) run();
      else queue.push(run);
    });
}

/** Returns the snapshot a live run on the workspace took before its first write (`RunRecord.snapshot`), or null. */
async function runStart(
  kernel: Kernel,
  workspace: WorkspaceId,
  run: RunId,
): Promise<SnapshotId | null> {
  for (const session of await sessionsOn(kernel, workspace)) {
    const found = await load(
      kernel,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found !== null) return found.record.snapshot;
  }

  return null;
}

/** Returns every registered workspace's record. */
async function workspaceRecords(kernel: Kernel): Promise<readonly WorkspaceRecord[]> {
  const refs = await kernel.store.refs.list("workspaces/");
  const found = await Promise.all(refs.map((ref) => load(kernel, ref, decodeWorkspaceRecord)));

  return found.flatMap((entry) => (entry === null ? [] : [entry.record]));
}

/** Returns the registered workspace whose identity is `identity`, or null. */
async function byIdentity(
  kernel: Kernel,
  identity: WorkspaceRecord["identity"],
): Promise<WorkspaceRecord | null> {
  return (await workspaceRecords(kernel)).find((record) => record.identity === identity) ?? null;
}

/** Announces a workspace change to this kernel's `Workspace.watch` listeners. */
function changed(kernel: Kernel, id: WorkspaceId): void {
  for (const listener of kernel.workspaceState.listeners) listener(id);
}
