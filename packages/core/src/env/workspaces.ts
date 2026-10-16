import { asId, SdkError } from "@nyte-ai/schema";
import type {
  Activation,
  AddOutcome,
  DiffOptions,
  EnvironmentIdentity,
  FileStatus,
  ForgetOutcome,
  PatchSet,
  RunId,
  SessionId,
  SnapshotId,
  WorkspaceId,
  WorkspaceInfo,
} from "@nyte-ai/schema";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import { decodeRunRecord, decodeWorkspaceRecord } from "../contract/records.ts";
import type { WorkspaceRecord } from "../contract/records.ts";
import type {
  HeldEntry,
  PageHolder,
  PatchCache,
  PatchSlot,
  SnapshotsApi,
  Workspace,
  Workspaces,
  WorkspaceState,
} from "../contract/workspace.ts";
import { createJobs, jobHandle } from "../engine/jobs.ts";
import { dropScans } from "../extend/resources.ts";
import { commit } from "../fold/commit.ts";
import { runRef, workspaceRef } from "../store/refs.ts";
import {
  attempt,
  listSessionRecords,
  liveRuns,
  load,
  MAIN,
  put,
  readSession,
  STALE,
} from "../store/session.ts";
import { objectId } from "../util/content.ts";
import { closable, coalesce, latest } from "../util/iterable.ts";
import { inspectWorkspaceAvailability, readWorkspace, workspaceRecords } from "./environment.ts";
import { mcpApi } from "./mcp.ts";
import { readTrustResolver } from "./trust.ts";
import type { TrustResolver } from "./trust.ts";
import type { StoreConnection } from "../contract/store.ts";

const PATCH_READ_MAX = 32;

const PATCH_READS = 4;

const PATCH_CACHES = 16;

const staleEntries = new WeakMap<HeldEntry, HeldEntry>();

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

export function createWorkspaces(
  kernel: Kernel,
  context: Pick<ConnectionContext, "principal">,
): Workspaces {
  return {
    async list() {
      const records = await workspaceRecords(kernel.store);
      const trust = await readTrustResolver(kernel);
      const infos = await Promise.all(
        records.map((record) => workspaceInfo(kernel, record.id, trust)),
      );

      return infos.flatMap((info) => (info === null ? [] : [info]));
    },
    async inspect(target) {
      const provider = kernel.environments.provider(target.kind);

      if (provider === undefined)
        throw new SdkError("unavailable", `No environment provider serves ${target.kind}.`);
      const inspected = await provider.inspect(target);

      const registered = await byIdentity(kernel.store, {
        kind: target.kind,
        identity: inspected.identity,
      });

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
      const identity = { kind: target.kind, identity: inspected.identity };
      const id = asId<"workspace">(await objectId(identity));

      return attempt<AddOutcome>(`Registering ${target.kind} workspace`, async () => {
        const existing = await byIdentity(kernel.store, identity);

        if (existing !== null) return { kind: "exists", workspace: existing.id };

        const record: WorkspaceRecord = {
          id,
          target,
          identity: inspected.identity,
          projectResources: options?.projectResources ?? null,
          projectSources: inspected.projectSources,
          addedBy: context.principal,
          createdAt: Date.now(),
        };

        const outcome = await commit(kernel, [
          {
            name: workspaceRef(id),
            target: await put(kernel.store, "workspace", record),
            expect: "absent",
          },
        ]);

        if (outcome.kind === "stale") return STALE;
        changed(kernel, id);

        return { kind: "added", workspace: id };
      });
    },
    async forget(id) {
      return attempt<ForgetOutcome>(`Forgetting ${id}`, async () => {
        const ref = await kernel.store.refs.get(workspaceRef(id));

        if (ref === null) return { kind: "missing" };
        const sessions = await sessionsOn(kernel.store, id);

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

export function workspaceHandle(
  kernel: Kernel,
  context: Pick<ConnectionContext, "origin">,
  id: WorkspaceId,
  client: object | null = null,
): Workspace {
  const viewing = async (): Promise<SessionId | null> => {
    const origin = context.origin;

    if (origin === null) return null;

    return (await readSession(kernel.store, origin.session))?.record.workspace === id
      ? origin.session
      : null;
  };

  const snapshots = async (): Promise<SnapshotsApi> => {
    const session = await viewing();

    const found =
      session === null
        ? await kernel.environments.workspaceSnapshots(id)
        : await kernel.environments.snapshots(session);

    if (found === null)
      throw new SdkError("unavailable", `Workspace ${id} takes no run snapshots.`);

    return found;
  };

  const origin = context.origin;

  const holder: PageHolder | null =
    origin === null && client === null
      ? null
      : {
          client: origin === null ? client : null,
          origin:
            origin === null
              ? null
              : {
                  session: origin.session,
                  head: origin.head ?? MAIN,
                  run: origin.run,
                  call: origin.call,
                  sequence: origin.sequence,
                },
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
        kernel.store,
        await kernel.store.refs.get(workspaceRef(id)),
        decodeWorkspaceRecord,
      );

      if (found === null) return { kind: "missing" };

      const outcome = await commit(kernel, [
        {
          name: workspaceRef(id),
          target: await put(kernel.store, "workspace", change(found.record)),
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
    mcp: mcpApi(kernel, id),
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
        projectResources:
          patch.projectResources === undefined ? record.projectResources : patch.projectResources,
      }));

      if (outcome.kind === "updated" && patch.projectResources !== undefined)
        await trustChanged(kernel);

      return outcome;
    },
    async reload() {
      if ((await readWorkspace(kernel.store, id)) === null) return { kind: "missing" };
      invalidateResources(kernel, id);
      await kernel.environments.detachWorkspace(id);

      for (const session of await sessionsOn(kernel.store, id)) {
        if (kernel.sessions.activation(session).kind !== "active")
          await kernel.environments.detach(session);

        if (
          kernel.runtimes().has(session) ||
          kernel.folds.folding(session) ||
          kernel.sessions.activation(session).kind !== "inactive"
        )
          await kernel.reloadPlugins(session).catch(() => undefined);
      }

      changed(kernel, id);

      return { kind: "updated" };
    },
    jobs: createJobs(kernel, context, id),
    job: (job) => jobHandle(kernel, job),
    async changes(run) {
      const found = await snapshots();
      const from = (await runStart(kernel.store, id, run)) ?? (await found.before(run));

      return found.diff(from, await found.after(run));
    },
    patches(run, paths, options) {
      return streamWorkspacePatches(kernel, { workspace: id, run, paths, options, snapshots });
    },
    files: async () => (await capabilities()).files,
    git: async () => (await capabilities()).git,
    browser: async () => (await capabilities()).browser,
  };
}

async function workspaceInfo(
  kernel: Kernel,
  id: WorkspaceId,
  trust?: TrustResolver,
): Promise<WorkspaceInfo | null> {
  const record = await readWorkspace(kernel.store, id);

  if (record === null) return null;

  const [availability, sessions] = await Promise.all([
    inspectWorkspaceAvailability(kernel, record),
    sessionsOn(kernel.store, id),
  ]);

  const runs = await Promise.all(sessions.map((session) => liveRuns(kernel.store, session)));

  return {
    id,
    target: record.target,
    identity: record.identity,
    availability,
    projectResources: record.projectResources,
    trusted: (trust ?? (await readTrustResolver(kernel)))(record),
    projectSources: record.projectSources,
    addedBy: record.addedBy,
    sessions: sessions.length,
    writers: runs.flat().map((run) => run.record.view.id),
  };
}

async function sessionsOn(
  store: StoreConnection,
  workspace: WorkspaceId,
): Promise<readonly SessionId[]> {
  return (await listSessionRecords(store)).flatMap((record) =>
    record.workspace === workspace ? [record.id] : [],
  );
}

export function settle(
  kernel: Kernel,
  session: SessionId,
  workspace: WorkspaceId,
  activation: Activation,
): void {
  if (JSON.stringify(kernel.sessions.activation(session)) === JSON.stringify(activation)) return;
  kernel.sessions.setActivation(session, activation);
  changed(kernel, workspace);
}

async function* streamWorkspacePatches(
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
  const from =
    (await runStart(kernel.store, input.workspace, run)) ?? (await snapshots.before(run));
  const to = await snapshots.after(run);
  let statuses: Promise<ReadonlyMap<string, FileStatus> | null> | null = null;

  const caches = kernel.workspaceState.patches;
  const key = JSON.stringify([input.workspace, run, options?.ignoreWhitespace === true]);
  const previous = caches.get(key);

  const current: PatchCache =
    previous?.revision === to ? previous : { revision: to, slots: new Map() };

  caches.delete(key);
  caches.set(key, current);

  for (const oldest of caches.keys()) {
    if (caches.size <= PATCH_CACHES) break;
    caches.delete(oldest);
  }

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
            statuses ??= snapshots.diff(from, to).then(
              (changes) => new Map(changes.files.map((file) => [file.path, file.status])),
              () => null,
            );
            const known = await statuses;
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

      if (old?.done === true && old.value !== null) entries.set(path, markPatchStale(old.value));
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

function markPatchStale(entry: HeldEntry): HeldEntry {
  const known = staleEntries.get(entry);

  if (known !== undefined) return known;
  const stale = { ...entry, fresh: false };
  staleEntries.set(entry, stale);

  return stale;
}

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

async function runStart(
  store: StoreConnection,
  workspace: WorkspaceId,
  run: RunId,
): Promise<SnapshotId | null> {
  for (const session of await sessionsOn(store, workspace)) {
    const found = await load(store, await store.refs.get(runRef(session, run)), decodeRunRecord);

    if (found !== null) return found.record.snapshot;
  }

  return null;
}

async function byIdentity(
  store: StoreConnection,
  input: { readonly kind: string; readonly identity: EnvironmentIdentity },
): Promise<WorkspaceRecord | null> {
  return (
    (await workspaceRecords(store)).find(
      (record) => record.target.kind === input.kind && record.identity === input.identity,
    ) ?? null
  );
}

/**
 * Applies a change to project trust everywhere it is read: a decision passes
 * to folders below and the `workspaceTrust` mode reaches every folder, so
 * every workspace's cached scan is dropped, its watchers hear the change,
 * and every live session reloads its plugins.
 */
export async function trustChanged(kernel: Kernel): Promise<void> {
  dropScans(kernel);

  for (const record of await workspaceRecords(kernel.store)) changed(kernel, record.id);

  await Promise.allSettled(
    [...kernel.runtimes().keys()].map((session) => kernel.reloadPlugins(session)),
  );
}

function changed(kernel: Kernel, id: WorkspaceId): void {
  for (const listener of kernel.workspaceState.listeners) listener(id);
}

function invalidateResources(kernel: Kernel, workspace: WorkspaceId): void {
  dropScans(kernel, (_session, cached) => cached.workspace === workspace);
}
