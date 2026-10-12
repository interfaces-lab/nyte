import { asId } from "@nyte-ai/schema";
import type {
  CommandOutcome,
  Configuration,
  ConfigurationPatch,
  CreateHeadOutcome,
  Cursor,
  Execution,
  HeadInfo,
  HeadName,
  Json,
  MergeOutcome,
  MessageId,
  Paged,
  ParentFilter,
  PartId,
  Placement,
  Position,
  PrincipalId,
  PromptOverride,
  ReceiptId,
  RefUpdate,
  RemoveHeadOutcome,
  RemoveSessionOutcome,
  Revision,
  RunId,
  SessionId,
  SessionInfo,
  UpdateOutcome,
  WorkspaceId,
} from "@nyte-ai/schema";
import { sendNow } from "./admission.ts";
import { staticContributions } from "./models.ts";
import { recordAcquisition } from "./durable.ts";
import { SdkError } from "./error.ts";
import { createHead, headHandle, mergeHead, removeHead } from "./head.ts";
import type { Head } from "./head.ts";
import type { Kernel } from "./kernel.ts";
import type { Part, PartDefinition, PartState } from "./parts.ts";
import type { ConnectionContext } from "./principals.ts";
import type { Receipt } from "./receipt.ts";
import { withdraw } from "./receipt-handles.ts";
import { receiptHandle } from "./receipts.ts";
import { decodeSeenRecord, decodeSessionRecord } from "./records.ts";
import type { HeadRecord, RunRecord, SessionRecord } from "./records.ts";
import { headRef, seenRef, sessionRef, workspaceRef } from "./refs.ts";
import type { Run } from "./run.ts";
import { runHandle, stopRun } from "./runs.ts";
import {
  MAIN,
  STALE,
  attempt,
  commit,
  liveRuns,
  load,
  put,
  readInbox,
  readSession,
  requireSession,
  sessionEvent,
} from "./session-state.ts";
import { closable, coalesce, latest } from "./watch.ts";

const DEFAULT_LIMIT = 50;

const DIRECTORY_EVENTS: ReadonlySet<string> = new Set([
  "session",
  "run",
  "head",
  "commit",
  "seen",
  "activation",
]);

export interface Session extends Head {
  readonly id: SessionId;
  head(name: HeadName): Head;
  readonly heads: {
    create(name: HeadName, input?: { readonly from?: Position }): Promise<CreateHeadOutcome>;
    merge(name: HeadName, options?: { readonly expect?: Revision }): Promise<MergeOutcome>;
    remove(name: HeadName, options?: { readonly expect?: Revision }): Promise<RemoveHeadOutcome>;
  };
  run(id: RunId): Run;
  receipt(id: ReceiptId): Receipt<unknown>;
  info(): Promise<SessionInfo>;
  update(patch: {
    readonly name?: string | null;
    readonly pinned?: boolean;
    readonly archived?: boolean;
    readonly workspace?: WorkspaceId;
  }): Promise<UpdateOutcome>;
  remove(): Promise<RemoveSessionOutcome>;
  stop(): Promise<{ readonly stopped: readonly RunId[]; readonly withdrawn: readonly MessageId[] }>;
  command(name: string, args?: Json): Promise<CommandOutcome>;
  readonly parts: {
    create<K extends PartDefinition>(
      kind: K,
      input: { readonly state: PartState<K>; readonly placement: Placement; readonly id?: PartId },
    ): Promise<Part<K>>;
  };
  part(id: PartId): Part<PartDefinition>;
}

export interface Sessions {
  watch(input?: {
    readonly parents?: ParentFilter;
    readonly limit?: number;
  }): AsyncIterable<readonly SessionInfo[]>;
  create(input?: {
    readonly id?: SessionId;
    readonly name?: string;
    readonly workspace?: WorkspaceId;
    readonly parent?: SessionId;
    readonly configuration?: Configuration | ConfigurationPatch;
    readonly prompt?: PromptOverride;
  }): Promise<Session>;
  list(input?: {
    readonly parents?: ParentFilter;
    readonly cursor?: Cursor;
    readonly limit?: number;
  }): Promise<Paged<SessionInfo>>;
}

/** Returns a handle on a session for a connection: its main head plus heads, runs, receipts, parts and management. Binds synchronously; no I/O. */
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

      return kernel.command(id, name, args);
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

/** Returns a part handle whose `update` and `act` first await the session's activation (§44a, §48h), so the part's definition is read with its owner's plugins loaded. */
function activated(
  kernel: Kernel,
  part: Part<PartDefinition>,
  session: SessionId,
): Part<PartDefinition> {
  return {
    ...part,
    async update(next) {
      await kernel.pluginsFor(session).ready;

      return part.update(next);
    },
    async act(action, input) {
      await kernel.pluginsFor(session).ready;

      return part.act(action, input);
    },
  };
}

/** Returns the session handle of the api a session's activation constructs (§44b): every head's `send`, `command`, `parts.create` and part handles run without awaiting the activation they are part of. */
export function activationSession(
  kernel: Kernel,
  context: ConnectionContext,
  id: SessionId,
): Session {
  return {
    ...sessionHandle(kernel, context, id),
    ...headHandle(kernel, context, id, MAIN, sendNow),
    head: (name) => headHandle(kernel, context, id, name, sendNow),
    command: async (name, args) => kernel.command(id, name, args),
    parts: { create: async (kind, input) => kernel.parts.create(context, id, kind, input) },
    part: (part) => kernel.parts.part(context, id, part),
  };
}

/** Returns the session directory for a connection. A `create` from a tool's step is an acquisition recorded on that step's call, so a re-run returns the session it created; a created session logs `configured` with its effective configuration (§48c) and is activated before `create` resolves (§44a). */
export function createSessions(kernel: Kernel, context: ConnectionContext): Sessions {
  return {
    watch: (input) => watchSessions(kernel, context.principal, input),
    create: async (input) =>
      sessionHandle(kernel, context, await create(kernel, context, input ?? {})),
    list: (input) => listSessions(kernel, context.principal, input),
  };
}

/** Returns the directory row: parent, workspace, heads, activation; null when the session ref is absent. */
export async function sessionInfo(
  kernel: Kernel,
  id: SessionId,
  principal: PrincipalId,
): Promise<SessionInfo | null> {
  const found = await readSession(kernel, id);

  if (found === null) return null;
  const { record } = found;
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
    workspace: record.workspace,
    pinned: record.pinned,
    archived: record.archived,
    activation: kernel.activation(id),
    heads,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
  };
}

/** Returns one page of the directory, newest activity first. */
export async function listSessions(
  kernel: Kernel,
  principal: PrincipalId,
  input?: { readonly parents?: ParentFilter; readonly cursor?: Cursor; readonly limit?: number },
): Promise<Paged<SessionInfo>> {
  const rows = await directory(kernel, input?.parents ?? { kind: "all" });
  const limit = Math.max(1, input?.limit ?? DEFAULT_LIMIT);
  const start = input?.cursor === undefined ? 0 : after(rows, input.cursor);
  const page = rows.slice(start, start + limit);
  const infos = await Promise.all(page.map((row) => sessionInfo(kernel, row.id, principal)));
  const last = page.at(-1);

  return {
    items: infos.flatMap((info) => (info === null ? [] : [info])),
    next:
      last !== undefined && start + limit < rows.length
        ? asId<"cursor">(`${last.lastActivityAt}:${last.id}`)
        : null,
  };
}

/** Yields the directory as it changes: the sidebar. `return()` unsubscribes at once. */
export function watchSessions(
  kernel: Kernel,
  principal: PrincipalId,
  input?: { readonly parents?: ParentFilter; readonly limit?: number },
): AsyncIterable<readonly SessionInfo[]> {
  return closable<readonly SessionInfo[]>(() => {
    let changes = 0;
    let shown: string | null = null;

    const ticks = coalesce(
      latest(changes, (push) =>
        kernel.bus.subscribeAll((_session, event) => {
          if (!DIRECTORY_EVENTS.has(event.kind)) return;
          changes += 1;
          push(changes);
        }),
      ),
    )[Symbol.asyncIterator]();

    return {
      async pull() {
        for (;;) {
          const tick = await ticks.next();

          if (tick.done) return tick;

          const page = await listSessions(kernel, principal, {
            parents: input?.parents,
            limit: input?.limit,
          });

          const key = JSON.stringify(page.items);

          if (key === shown) continue;
          shown = key;

          return { done: false, value: page.items };
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

  const selected = await selectedOf(kernel, id, input.configuration);
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

/** Returns the configuration a new session resolves to from the host's static contributions, null when there is nothing to resolve to (§48c). */
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

async function selectedOf(
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

  throw new SdkError("invalid", `The configuration is ${result.kind}.`, {
    issues: result.kind === "invalid" ? result.issues : [],
  });
}

/** Updates a session's record; a relocation detaches its environment and installs a new plugin runtime (§37k, §44c). */
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
    const children = await childrenOf(kernel, context, session);

    if (children.length > 0) return { kind: "has-children", children };
    const refs = await kernel.store.refs.list(`${sessionRef(session)}/`);

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
    await kernel.closePlugins(session);
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

async function childrenOf(
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

async function directory(kernel: Kernel, parents: ParentFilter): Promise<readonly SessionRecord[]> {
  const refs = await kernel.store.refs.list("sessions/");

  const records = await Promise.all(
    refs.flatMap((ref) =>
      ref.name.split("/").length === 2 ? [load(kernel, ref, decodeSessionRecord)] : [],
    ),
  );

  return records
    .flatMap((found) => (found === null ? [] : [found.record]))
    .filter(
      (record) =>
        parents.kind === "all" ||
        (parents.kind === "roots" ? record.parent === null : record.parent === parents.session),
    )
    .sort(
      (left, right) =>
        right.lastActivityAt - left.lastActivityAt ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}

function after(rows: readonly SessionRecord[], cursor: Cursor): number {
  const separator = cursor.indexOf(":");
  const at = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);

  if (separator < 0 || !Number.isFinite(at))
    throw new SdkError("invalid", `${cursor} is not a directory cursor`);

  const index = rows.findIndex(
    (row) => row.lastActivityAt < at || (row.lastActivityAt === at && row.id > id),
  );

  return index < 0 ? rows.length : index;
}
