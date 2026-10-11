import { asId } from "@nyte-ai/schema";
import type {
  Activation,
  DiffOptions,
  Disposer,
  FileStatus,
  ForgetOutcome,
  PatchEntry,
  PatchSet,
  RunId,
  SessionId,
  SnapshotId,
  WorkspaceId,
  WorkspaceInfo,
} from "@nyte-ai/schema";
import { availabilityOf, readWorkspace } from "./environment-registry.ts";
import type { SnapshotsApi } from "./environment.ts";
import { SdkError } from "./error.ts";
import { createJobs, jobHandle } from "./jobs.ts";
import type { PageHolder } from "./pages.ts";
import { pluginSessionOf } from "./plugin-api.ts";
import { sessionPlugins } from "./plugin-runtime.ts";
import type { Kernel } from "./kernel.ts";
import { requireAuthority } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { decodeRunRecord, decodeSessionRecord, decodeWorkspaceRecord } from "./records.ts";
import type { WorkspaceRecord } from "./records.ts";
import { runRef, workspaceRef } from "./refs.ts";
import { invalidateResources } from "./resources.ts";
import {
  MAIN,
  STALE,
  attachesHere,
  attempt,
  commit,
  liveRuns,
  load,
  put,
  readSession,
} from "./session-state.ts";
import { closable, coalesce, latest } from "./watch.ts";
import type { Workspace, Workspaces } from "./workspace.ts";

/** Carries workspace changes in this process: registering, forgetting, `update`, `reload` and an activation announce them; `Workspace.watch` listens, alongside the bus's `session` and `run` events that move `sessions` and `writers`. One per kernel, created on first use. */
interface WorkspaceBus {
  /** Calls every listener with the workspace that changed. */
  changed(id: WorkspaceId): void;
  /** Calls the listener on every change; the disposer stops it. */
  subscribe(listener: (id: WorkspaceId) => void): Disposer;
}

/** Returns one path's patch as `patches` yields it: `fresh` false while it is the previous revision's, held until the fresh read lands. */
type HeldEntry = PatchEntry & { readonly fresh: boolean };

/** Returns one path's read at a revision: whether it landed, and the entry, null when the revision does not report the path. */
type PatchSlot = {
  done: boolean;
  value: HeldEntry | null;
  readonly read: Promise<HeldEntry | null>;
};

/** Returns the patch cache of one run under one set of diff options: the revision it was read at and each path's read. */
type PatchCache = { readonly revision: SnapshotId; readonly slots: Map<string, PatchSlot> };

const PATCH_READ_MAX = 32;

const PATCH_READS = 4;

const buses = new WeakMap<Kernel, WorkspaceBus>();

const activations = new WeakMap<Kernel, Map<SessionId, Promise<Activation>>>();

const patchCaches = new WeakMap<Kernel, Map<string, PatchCache>>();

const staleEntries = new WeakMap<HeldEntry, HeldEntry>();

const ACTIVE: Activation = { kind: "active" };

const INACTIVE: Activation = { kind: "inactive" };

/** Returns the workspaces registered on this host for a connection; every member checks its `@authority` tag against the context's authority. `list` reads every `workspaces/` ref through `workspaceInfo`. `inspect` asks the provider of the target's kind (`SdkError("unavailable")` when none serves it) and names the registered workspace with the same identity, if any. `add` answers `unavailable { reason }` when no provider serves the kind (`unsupported`) or its `inspect` says unavailable (`unreachable` when it throws), `stale { identity }` when `expect.identity` differs from the inspected one, `exists` when a workspace with that identity is registered, and otherwise writes a `WorkspaceRecord` under a minted id (`expect: "absent"`; `projectResources` default true, `projectSources` as inspected, `addedBy` the context's principal) and answers `added`. `forget` answers `missing` without a record and `busy { sessions }` while sessions use it; otherwise it deletes the ref, detaches the workspace's own environment, drops its cached resources and answers `forgotten`. Each change is announced on the workspace bus. What `kernel.workspaces` holds as `CORE_CONTEXT`; a connection binds its own. */
export function createWorkspaces(kernel: Kernel, context: ConnectionContext): Workspaces {
  const need = (authority: "participant" | "owner", operation: string): void =>
    requireAuthority(context.authority, authority, `workspaces.${operation}`);

  return {
    async list() {
      need("participant", "list");
      const records = await workspaceRecords(kernel);
      const infos = await Promise.all(records.map((record) => workspaceInfo(kernel, record.id)));

      return infos.flatMap((info) => (info === null ? [] : [info]));
    },
    async inspect(target) {
      need("owner", "inspect");
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
      need("owner", "add");
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
      busOf(kernel).changed(id);

      return { kind: "added", workspace: id };
    },
    async forget(id) {
      need("owner", "forget");

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
        busOf(kernel).changed(id);

        return { kind: "forgotten" };
      });
    },
  };
}

/** Returns a handle on a workspace for a connection; binds synchronously, no I/O, and checks each member's `@authority` tag against the context's authority. A context whose `origin` names a session on this workspace (a tool invocation's) is that session's view: its capabilities, snapshots and jobs go through the session's environment; otherwise the workspace's own environment serves them (§37f). `info` is `workspaceInfo` (`SdkError("unknown")` when the record is gone); `watch` yields it coalesced on workspace-bus changes and on `session` and `run` events, ending when the record is gone. `update` rewrites `projectResources` on the record, drops its cached resources and announces it: `missing` without a record. `reload` drops the cached resources, detaches the workspace's own environment and re-activates every session on it (`activateSession` with `reload`): `missing` without a record. `jobs` is `createJobs(kernel, context, id)` and `job(id)` is `jobHandle`. `changes(run)` diffs the run's first snapshot (`RunRecord.snapshot` while the run is live, else the provider's `before(run)`) to `after(run)` (`SdkError("unavailable")` when the environment takes none). `patches(run, paths, options)` yields full `PatchSet`s over the same revision: paths not yet read at it are read through the provider's `snapshots.patches` in batches of at most 32 with at most 4 reads in flight, each landing batch yielding the map again, and a batch whose read throws yielding its paths as `failed { reason }` (with the status the snapshots' diff gives, `modified` when it cannot say; left out when the diff no longer reports them) and leaving them uncached so a later call reads them again; reads are cached by (workspace, run, options, revision, path) across calls, so a path read once at a revision is never read again, and while the revision moved the previous revision's entry is held with `fresh: false` until its fresh read lands; a path the new revision no longer reports leaves. `files()`, `git()` and `browser()` are the matching entry of the environment registry's `capabilities` (session view) or `workspaceCapabilities`; pages opened through the browser are held by the origin's head when the context acts from a step, by no head for a client (§37i). What `kernel.workspace(id)` returns as `CORE_CONTEXT`; a connection and an invocation bind their own. */
export function workspaceHandle(
  kernel: Kernel,
  context: ConnectionContext,
  id: WorkspaceId,
): Workspace {
  const need = (authority: "participant" | "owner", operation: string): void =>
    requireAuthority(context.authority, authority, `workspace.${operation}`);

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
      ? kernel.environments.workspaceCapabilities(id, context.authority, holder)
      : kernel.environments.capabilities(session, context.authority, holder);
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
      need("participant", "info");
      const info = await workspaceInfo(kernel, id);

      if (info === null) throw new SdkError("unknown", `Workspace ${id} is not registered.`);

      return info;
    },
    watch() {
      need("participant", "watch");

      return closable<WorkspaceInfo>(() => {
        let changes = 0;
        let shown: string | null = null;

        const ticks = coalesce(
          latest(changes, (push) => {
            const bump = (): void => {
              changes += 1;
              push(changes);
            };

            const stopWorkspaces = busOf(kernel).subscribe((changed) => {
              if (changed === id) bump();
            });

            const stopSessions = kernel.bus.subscribeAll((_session, event) => {
              if (event.kind === "session" || event.kind === "run") bump();
            });

            return () => {
              stopWorkspaces();
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
      need("owner", "update");

      const outcome = await rewrite(`Updating ${id}`, (record) => ({
        ...record,
        projectResources: patch.projectResources ?? record.projectResources,
      }));

      if (outcome.kind === "updated") {
        invalidateResources(kernel, id);
        busOf(kernel).changed(id);
      }

      return outcome;
    },
    async reload() {
      need("owner", "reload");

      if ((await readWorkspace(kernel, id)) === null) return { kind: "missing" };
      invalidateResources(kernel, id);
      await kernel.environments.detachWorkspace(id);

      for (const session of await sessionsOn(kernel, id))
        await activateSession(kernel, session, { reload: true });
      busOf(kernel).changed(id);

      return { kind: "updated" };
    },
    jobs: createJobs(kernel, context, id),
    job: (job) => jobHandle(kernel, context, job),
    async changes(run) {
      need("participant", "changes");
      const found = await snapshots();
      const from = (await runStart(kernel, id, run)) ?? (await found.before(run));

      return found.diff(from, await found.after(run));
    },
    patches(run, paths, options) {
      need("participant", "patches");

      return patchesOf(kernel, { workspace: id, run, paths, options, snapshots });
    },
    files: async () => (await capabilities()).files,
    git: async () => (await capabilities()).git,
    browser: async () => (await capabilities()).browser,
  };
}

/** Activates a session on this host and returns how it stands, set with `kernel.setActivation` when it changed. An unknown session activates nothing. The session's plugins are loaded first when its runtime has had none loaded in this process (`sessionPlugins`: the built-ins, then the session's own list or `kernel.hostPlugins`, §36c); with `reload`, the runtime replaces its set with that full list, so every plugin re-activates over freshly resolved resources and one a failed activation rejected is tried again (§37l). A session this host's execution does not cover then stays `inactive` and attaches nothing; its plugins resolved no environment or resources (§37m); on a `dispatch` kernel every session attaches, as for `run` (§42p). Otherwise its environment attaches (`kernel.env`): `active` once it attaches; `unavailable { workspace, reason }` when no provider serves the workspace's kind (`unsupported`) or its `inspect` says unavailable; `failed { message }` when attaching throws otherwise. The workspace bus announces the change. Concurrent calls share one activation, a `reload` running after the one in flight. What `sessions.create`, a known session's first `pluginsFor` and `advance` after this host started, and `Workspace.reload()` run. */
export function activateSession(
  kernel: Kernel,
  session: SessionId,
  options?: { readonly reload?: boolean },
): Promise<Activation> {
  const table = activations.get(kernel) ?? new Map<SessionId, Promise<Activation>>();
  activations.set(kernel, table);
  const running = table.get(session);
  const reload = options?.reload === true;

  if (running !== undefined && !reload) return running;

  const started = (running ?? Promise.resolve(INACTIVE))
    .catch(() => INACTIVE)
    .then(() => activate(kernel, session, reload));

  table.set(session, started);

  void started
    .finally(() => {
      if (table.get(session) === started) table.delete(session);
    })
    .catch(() => undefined);

  return started;
}

/** Resolves once a session is activated in this process: the activation in flight, or a new one when its runtime has loaded nothing yet (§36c). A caller acting through a plugin api of the same session while its activation is in flight is that activation re-entering itself (a plugin sending from its own `activate`): it does not wait, since the activation waits on it. What `advance`, admission and `session.command` await before running hooks (§37j). */
export async function ensureActivated(
  kernel: Kernel,
  session: SessionId,
  context?: ConnectionContext,
): Promise<void> {
  const running = activations.get(kernel)?.get(session);

  if (running !== undefined) {
    if (context === undefined || pluginSessionOf(context) !== session) await running;

    return;
  }

  if (kernel.runtimes().get(session)?.loaded() !== true) await activateSession(kernel, session);
}

/** Returns a registered workspace's record with its live fields, or null when `workspaces/<id>` is absent: `availability` from its provider's `inspect` (`unavailable { reason: "unsupported" }` when no provider serves the kind), `sessions` the number of session records naming it, and `writers` the live runs of those sessions. */
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

async function activate(kernel: Kernel, session: SessionId, reload: boolean): Promise<Activation> {
  const found = await readSession(kernel, session);

  if (found === null) return kernel.activation(session);
  const workspace = found.record.workspace;
  const runtime = kernel.pluginsFor(session);

  if (reload) await runtime.replace(sessionPlugins(kernel, runtime));
  else if (!runtime.loaded()) await runtime.load(sessionPlugins(kernel, runtime));

  if (!(await attachesHere(kernel, session))) return settle(kernel, session, workspace, INACTIVE);

  try {
    await kernel.env(session);

    return settle(kernel, session, workspace, ACTIVE);
  } catch (error) {
    const record = await readWorkspace(kernel, workspace);
    const availability = record === null ? null : await availabilityOf(kernel, record.target);

    return settle(
      kernel,
      session,
      workspace,
      availability?.kind === "unavailable"
        ? { kind: "unavailable", workspace, reason: availability.reason }
        : { kind: "failed", message: error instanceof Error ? error.message : String(error) },
    );
  }
}

function settle(
  kernel: Kernel,
  session: SessionId,
  workspace: WorkspaceId,
  activation: Activation,
): Activation {
  if (JSON.stringify(kernel.activation(session)) !== JSON.stringify(activation)) {
    kernel.setActivation(session, activation);
    busOf(kernel).changed(workspace);
  }

  return activation;
}

/** Yields a run's patches for `paths` as `Workspace.patches` describes. */
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

  const caches = patchCaches.get(kernel) ?? new Map<string, PatchCache>();
  patchCaches.set(kernel, caches);
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

/** Returns a held entry marked `fresh: false`, the same object each time for the same entry. */
function staleOf(entry: HeldEntry): HeldEntry {
  const known = staleEntries.get(entry);

  if (known !== undefined) return known;
  const stale = { ...entry, fresh: false };
  staleEntries.set(entry, stale);

  return stale;
}

/** Returns a runner that starts at most `size` pieces of work at once, the rest in call order. */
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

/** Returns the snapshot a live run took before its first write-class call (`RunRecord.snapshot`), looked up in the sessions on a workspace; null when no live run there has one. */
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

function busOf(kernel: Kernel): WorkspaceBus {
  const known = buses.get(kernel);

  if (known !== undefined) return known;
  const listeners = new Set<(id: WorkspaceId) => void>();

  const created: WorkspaceBus = {
    changed(id) {
      for (const listener of listeners) listener(id);
    },
    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };

  buses.set(kernel, created);

  return created;
}
