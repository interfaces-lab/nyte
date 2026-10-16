import { asId } from "@nyte-ai/schema";
import type {
  Activation,
  Configuration,
  ConfigurationPatch,
  Cursor,
  Execution,
  HeadInfo,
  HeadName,
  MessageId,
  Paged,
  ParentFilter,
  PrincipalId,
  RefUpdate,
  RemoveSessionOutcome,
  Revision,
  RunId,
  SessionId,
  SessionInfo,
  UpdateOutcome,
} from "@nyte-ai/schema";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { Part, PartDefinition } from "../contract/parts.ts";
import { decodeSeenRecord, decodeSessionRecord } from "../contract/records.ts";
import type { HeadRecord, RunRecord, SessionRecord } from "../contract/records.ts";
import type { Head, Session, Sessions } from "../contract/session.ts";
import { sendNow } from "../engine/admission.ts";
import { refusalError, staticContributions } from "../engine/contributions.ts";
import { recordAcquisition } from "../engine/durable.ts";
import { stopRun } from "../engine/fence.ts";
import { receiptHandle, withdraw } from "../engine/receipts.ts";
import { runHandle } from "../engine/runs.ts";
import { configure } from "../extend/settings.ts";
import { commit } from "../fold/commit.ts";
import { releaseParts } from "../store/parts.ts";
import { headRef, seenRef, sessionRef, workspaceRef } from "../store/refs.ts";
import {
  attempt,
  liveRuns,
  load,
  MAIN,
  put,
  readInbox,
  readSession,
  requireSession,
  sessionEvent,
  STALE,
} from "../store/session.ts";
import { SdkError } from "../util/error.ts";
import { closable, coalesce, latest } from "../util/iterable.ts";
import { createHead, headHandle, mergeHead, removeHead } from "./head.ts";

const DEFAULT_LIMIT = 50;

const DIRECTORY_EVENTS: ReadonlySet<string> = new Set([
  "session",
  "run",
  "head",
  "commit",
  "seen",
  "activation",
]);

interface DirectoryEntry {
  readonly version: Revision;
  readonly activation: Activation;
  readonly info: SessionInfo;
  readonly fingerprint: string;
}

export function sessionHandle(kernel: Kernel, context: ConnectionContext, id: SessionId): Session {
  return {
    ...headHandle(kernel, context, id, MAIN),
    id,
    head: (name) => headHandle(kernel, context, id, name),
    heads: {
      create: (name, input) => createHead(kernel, id, name, input),
      merge: (name, options) => mergeHead(kernel, id, name, options),
      remove: (name, options) => removeHead(kernel, id, name, options),
    },
    run: (run) => runHandle(kernel, id, run),
    receipt: (receipt) => receiptHandle(kernel, id, receipt),
    async info() {
      const info = await sessionInfo(kernel, id, context.principal);

      if (info === null) throw new SdkError("unknown", `No session has the id ${id}.`);

      return info;
    },
    update: (patch) => update(kernel, id, patch),
    remove: () => remove(kernel, context, id),
    stop: () => stop(kernel, id),
    async command(name, args) {
      await kernel.pluginsFor(id).ready;

      return kernel.command(context, id, name, args);
    },
    parts: {
      async create(kind, input) {
        await kernel.pluginsFor(id).ready;

        return kernel.parts.create(context, id, kind, input);
      },
    },
    part: (part) => activated(kernel, kernel.parts.part(context, id, part), id),
  };
}

function activated(
  kernel: Kernel,
  part: Part<PartDefinition>,
  session: SessionId,
): Part<PartDefinition> {
  return {
    ...part,
    async update(next, options) {
      await kernel.pluginsFor(session).ready;

      return part.update(next, options);
    },
    async act(action, input) {
      await kernel.pluginsFor(session).ready;

      return part.act(action, input);
    },
  };
}

export function activationSession(
  kernel: Kernel,
  context: ConnectionContext,
  id: SessionId,
): Session {
  const head = (name: HeadName): Head => ({
    ...headHandle(kernel, context, id, name, sendNow),
    configure: (patch) => configure(kernel, id, name, patch, true),
  });

  return {
    ...sessionHandle(kernel, context, id),
    ...head(MAIN),
    head,
    command: async (name, args) => kernel.command(context, id, name, args),
    parts: { create: async (kind, input) => kernel.parts.create(context, id, kind, input) },
    part: (part) => kernel.parts.part(context, id, part),
  };
}

export function createSessions(kernel: Kernel, context: ConnectionContext): Sessions {
  return {
    watch: (input) => watchSessions(kernel, context.principal, input),
    create: async (input) =>
      sessionHandle(kernel, context, await create(kernel, context, input ?? {})),
    list: (input) => listSessions(kernel, context.principal, input),
  };
}

export async function sessionInfo(
  kernel: Kernel,
  id: SessionId,
  principal: PrincipalId,
): Promise<SessionInfo | null> {
  const found = await readSession(kernel, id);

  if (found === null) return null;
  return describeSession(kernel, found.record, principal);
}

async function describeSession(
  kernel: Kernel,
  record: SessionRecord,
  principal: PrincipalId,
): Promise<SessionInfo> {
  const id = record.id;
  const runs = await liveRuns(kernel, id);

  const heads = await Promise.all(
    record.heads.map((head) =>
      headInfo(
        kernel,
        id,
        principal,
        head,
        runs.find((run) => run.record.view.head === head.name)?.record,
      ),
    ),
  );

  return {
    id: record.id,
    name: record.name,
    parent: record.parent,
    call: record.origin?.call ?? null,
    workspace: record.workspace,
    pinned: record.pinned,
    archived: record.archived,
    activation: kernel.activation(id),
    heads,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
  };
}

async function listSessions(
  kernel: Kernel,
  principal: PrincipalId,
  input?: { readonly parents?: ParentFilter; readonly cursor?: Cursor; readonly limit?: number },
): Promise<Paged<SessionInfo>> {
  const limit = Math.max(1, input?.limit ?? DEFAULT_LIMIT);
  const rows = await kernel.store.sessions.list({
    parents: input?.parents ?? { kind: "all" },
    after: input?.cursor === undefined ? undefined : directoryCursor(input.cursor),
    limit: limit + 1,
  });
  const infos = await Promise.all(
    rows.slice(0, limit).map(async ({ ref }) => {
      const found = await load(kernel, ref, decodeSessionRecord);

      return found === null ? null : describeSession(kernel, found.record, principal);
    }),
  );
  const items = infos.flatMap((info) => (info === null ? [] : [info]));
  const last = items.at(-1);

  return {
    items,
    next:
      last !== undefined && rows.length > limit
        ? asId<"cursor">(`${last.lastActivityAt}:${last.id}`)
        : null,
  };
}

export function watchSessions(
  kernel: Kernel,
  principal: PrincipalId,
  input?: { readonly parents?: ParentFilter; readonly limit?: number },
): AsyncIterable<readonly SessionInfo[]> {
  return closable<readonly SessionInfo[]>(() => {
    let changes = 0;
    let shown: readonly SessionInfo[] | null = null;
    let cached = new Map<SessionId, DirectoryEntry>();

    const ticks = coalesce(
      latest(changes, (push) => {
        const changed = (): void => {
          changes += 1;
          push(changes);
        };
        const dispose = kernel.bus.subscribeAll((_session, event) => {
          if (!DIRECTORY_EVENTS.has(event.kind)) return;
          changed();
        });
        const timer = kernel.poll === null ? undefined : setInterval(changed, kernel.poll);

        return () => {
          dispose();
          clearInterval(timer);
        };
      }),
    )[Symbol.asyncIterator]();

    return {
      async pull() {
        for (;;) {
          const tick = await ticks.next();

          if (tick.done) return tick;

          const rows = await kernel.store.sessions.list({
            parents: input?.parents ?? { kind: "all" },
            limit: Math.max(1, input?.limit ?? DEFAULT_LIMIT),
          });
          const next = new Map<SessionId, DirectoryEntry>();
          const infos = await Promise.all(
            rows.map(async ({ ref, version }) => {
              const id = asId<"session">(ref.name.slice("sessions/".length));
              const previous = cached.get(id);
              const activation = kernel.activation(id);

              if (previous?.version === version && previous.activation === activation) {
                next.set(id, previous);

                return previous.info;
              }
              const found = await load(kernel, ref, decodeSessionRecord);

              if (found === null) return null;
              const current = await describeSession(kernel, found.record, principal);
              const fingerprint = JSON.stringify(current);
              const info = previous?.fingerprint === fingerprint ? previous.info : current;
              next.set(id, { version, activation, fingerprint, info });

              return info;
            }),
          );
          cached = next;
          const items = infos.flatMap((info) => (info === null ? [] : [info]));

          const previous = shown;

          if (
            previous !== null &&
            items.length === previous.length &&
            items.every((info, index) => info === previous[index])
          )
            continue;
          shown = items;

          return { done: false, value: items };
        }
      },
      close() {
        void ticks.return?.();
      },
    };
  });
}

async function create(
  kernel: Kernel,
  context: ConnectionContext,
  input: NonNullable<Parameters<Sessions["create"]>[0]>,
): Promise<SessionId> {
  const origin = context.origin;
  const minted = input.id ?? asId<"session">(crypto.randomUUID());

  const acquired =
    origin === null || origin.call === null
      ? minted
      : await recordAcquisition(
          kernel,
          { session: origin.session, call: origin.call },
          input.id ?? `acq:${origin.sequence.next()}`,
          minted,
        );

  const id = typeof acquired === "string" ? asId<"session">(acquired) : minted;

  if ((await readSession(kernel, id)) !== null) return id;
  const parent = input.parent === undefined ? null : await requireSession(kernel, input.parent);
  const workspace = input.workspace ?? parent?.record.workspace ?? kernel.defaultWorkspace;

  if (workspace === null)
    throw new SdkError("unknown", "No workspace was named and the host has none by default.");

  if ((await kernel.store.refs.get(workspaceRef(workspace))) === null)
    throw new SdkError("unknown", `Workspace ${workspace} is not registered on this host.`);

  const selected = await resolveInitialConfiguration(kernel, id, input.configuration);
  const at = Date.now();

  const record: SessionRecord = {
    id,
    name: input.name ?? null,
    parent: input.parent ?? null,
    origin:
      origin === null || origin.run === null || origin.head === null
        ? null
        : { run: origin.run, head: origin.head, call: origin.call },
    workspace,
    pinned: false,
    archived: false,
    createdAt: at,
    lastActivityAt: at,
    heads: [{ name: MAIN, stack: null, selected, lastRun: null }],
    prompt: input.prompt ?? null,
  };

  const target = await put(kernel, "session", record, at);
  const effective = selected ?? (await defaults(kernel, id));

  const configured: readonly RefUpdate[] =
    effective === null
      ? []
      : [
          {
            name: sessionRef(id),
            target,
            event: { head: MAIN, kind: "configured", selected, effective },
          },
        ];

  const outcome = await commit(kernel, [
    { name: sessionRef(id), target, expect: "absent", event: await sessionEvent(kernel, record) },
    ...configured,
  ]);

  if (outcome.kind === "set") await Promise.allSettled([kernel.pluginsFor(id).ready]);

  return id;
}

async function defaults(kernel: Kernel, session: SessionId): Promise<Configuration | null> {
  const result = await kernel.resolveConfiguration({
    session,
    head: MAIN,
    selected: null,
    patch: null,
    contributions: staticContributions(kernel),
  });

  return result.kind === "exact" ? result : null;
}

async function resolveInitialConfiguration(
  kernel: Kernel,
  session: SessionId,
  configuration: Configuration | ConfigurationPatch | undefined,
): Promise<Configuration | null> {
  if (configuration === undefined) return null;

  if ("kind" in configuration) return configuration;

  const result = await kernel.resolveConfiguration({
    session,
    head: MAIN,
    selected: null,
    patch: configuration,
    contributions: staticContributions(kernel),
  });

  if (result.kind === "exact") return result;

  throw refusalError(result);
}

async function update(
  kernel: Kernel,
  session: SessionId,
  patch: Parameters<Session["update"]>[0],
): Promise<UpdateOutcome> {
  const { outcome, moved } = await attempt<{
    readonly outcome: UpdateOutcome;
    readonly moved: boolean;
  }>(`Updating ${session}`, async () => {
    const found = await requireSession(kernel, session);
    const workspace = patch.workspace ?? found.record.workspace;
    const moving = workspace !== found.record.workspace;

    if (moving) {
      const runs = await liveRuns(kernel, session);

      if (runs.length > 0)
        return {
          outcome: { kind: "busy", runs: runs.map((run) => run.record.view.id) },
          moved: false,
        };

      if ((await kernel.store.refs.get(workspaceRef(workspace))) === null)
        return { outcome: { kind: "unknown-workspace" }, moved: false };
    }

    const record: SessionRecord = {
      ...found.record,
      name: patch.name === undefined ? found.record.name : patch.name,
      pinned: patch.pinned ?? found.record.pinned,
      archived: patch.archived ?? found.record.archived,
      workspace,
    };

    if (
      record.name === found.record.name &&
      record.pinned === found.record.pinned &&
      record.archived === found.record.archived &&
      !moving
    )
      return { outcome: { kind: "updated" }, moved: false };

    const written = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record),
        expect: found.ref.revision,
        event: await sessionEvent(kernel, record),
      },
    ]);

    return written.kind === "set" ? { outcome: { kind: "updated" }, moved: moving } : STALE;
  });

  if (moved) {
    await kernel.environments.detach(session);
    await Promise.allSettled([kernel.reloadPlugins(session)]);
  }

  return outcome;
}

async function remove(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
): Promise<RemoveSessionOutcome> {
  return attempt<RemoveSessionOutcome>(`Removing ${session}`, async () => {
    const found = await requireSession(kernel, session);
    const runs = await liveRuns(kernel, session);

    if (runs.length > 0) return { kind: "busy", runs: runs.map((run) => run.record.view.id) };
    const children = await listChildSessionIds(kernel, context, session);

    if (children.length > 0) return { kind: "has-children", children };

    const refs = [
      ...(await kernel.store.refs.list(`${sessionRef(session)}/`)),
      ...(await kernel.store.refs.list(`kv/session:${session}/`)),
    ];

    const outcome = await commit(kernel, [
      ...refs.map((ref): RefUpdate => ({ name: ref.name, target: null, expect: ref.revision })),
      {
        name: sessionRef(session),
        target: null,
        expect: found.ref.revision,
        event: await sessionEvent(kernel, found.record),
      },
    ]);

    if (outcome.kind === "stale") return STALE;
    kernel.pluginState.assigned.delete(session);
    kernel.workspaceState.scans.delete(session);
    await kernel.closePlugins(session);
    kernel.forget(session);
    releaseParts(kernel.partTable, session);

    await Promise.allSettled([
      ...kernel.jobs
        .list(found.record.workspace)
        .flatMap((job) =>
          job.view.session === session && job.view.state.kind === "running"
            ? [job.process.stop()]
            : [],
        ),
      kernel.pages.release({ session }),
    ]);

    await kernel.environments.detach(session);

    return { kind: "removed" };
  });
}

async function stop(
  kernel: Kernel,
  session: SessionId,
): Promise<{ readonly stopped: readonly RunId[]; readonly withdrawn: readonly MessageId[] }> {
  const found = await requireSession(kernel, session);
  const stopped: RunId[] = [];
  const withdrawn: MessageId[] = [];

  for (const run of await liveRuns(kernel, session)) {
    const id = run.record.view.id;

    if ((await stopRun(kernel, session, id)).kind === "requested") stopped.push(id);
  }

  const prefix = `${sessionRef(session)}/inbox/`;

  for (const ref of await kernel.store.refs.list(prefix)) {
    const head = asId<"head">(ref.name.slice(prefix.length));
    const inbox = await readInbox(kernel, session, head);
    withdrawn.push(...(await withdraw(kernel, session, head, inbox.messages)));
  }

  for (const head of found.record.heads) kernel.wakes.notify(session, head.name);

  return { stopped, withdrawn };
}

async function listChildSessionIds(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
): Promise<readonly SessionId[]> {
  const children: SessionId[] = [];
  let cursor: Cursor | undefined;

  do {
    const page = await listSessions(kernel, context.principal, {
      parents: { kind: "children", session },
      cursor,
      limit: 100,
    });

    children.push(...page.items.map((info) => info.id));
    cursor = page.next ?? undefined;
  } while (cursor !== undefined);

  return children;
}

async function headInfo(
  kernel: Kernel,
  id: SessionId,
  principal: PrincipalId,
  head: HeadRecord,
  run: RunRecord | undefined,
): Promise<HeadInfo> {
  const { refs } = kernel.store;

  const [ref, seen] = await Promise.all([
    refs.get(headRef(id, head.name)),
    refs.get(seenRef(id, principal, head.name)).then((ref) => load(kernel, ref, decodeSeenRecord)),
  ]);

  const commit = ref === null || ref.target === null ? null : asId<"commit">(ref.target);

  return {
    name: head.name,
    tip: commit === null ? { kind: "start" } : { kind: "commit", id: commit },
    stack: head.stack,
    execution: run === undefined ? { kind: "idle", lastRun: head.lastRun } : execution(run),
    unread: commit !== (seen?.record.commit ?? null),
  };
}

function execution(run: RunRecord): Execution {
  if (run.waiting !== null) return { kind: "waiting", run: run.view, on: run.waiting };

  if (run.retrying !== null)
    return {
      kind: "retrying",
      run: run.view,
      until: run.retrying.until,
      reason: run.retrying.reason,
    };

  return { kind: "live", run: run.view, phase: run.phase, stopping: run.stopping };
}

function directoryCursor(cursor: Cursor): { readonly at: number; readonly id: SessionId } {
  const separator = cursor.indexOf(":");
  const at = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);

  if (separator < 0 || !Number.isFinite(at))
    throw new SdkError("invalid", `${cursor} is not a directory cursor`);

  return { at, id: asId<"session">(id) };
}
