import { asId } from "@nyte-ai/schema";
import type {
  CommandOutcome,
  CreateHeadOutcome,
  Cursor,
  HeadName,
  Json,
  MergeOutcome,
  MessageId,
  PartId,
  Placement,
  Position,
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
import { listSessions } from "./directory.ts";
import { SdkError } from "./error.ts";
import { headHandle } from "./head.ts";
import type { Head } from "./head.ts";
import { createHead, mergeHead, removeHead } from "./heads.ts";
import type { Kernel } from "./kernel.ts";
import type { Part, PartDefinition, PartState } from "./parts.ts";
import { requireAuthority } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import type { Receipt } from "./receipt.ts";
import { withdraw } from "./receipt-handles.ts";
import { receiptHandle } from "./receipts.ts";
import type { SessionRecord } from "./records.ts";
import { sessionRef, workspaceRef } from "./refs.ts";
import type { Run } from "./run.ts";
import { runHandle, stopRun } from "./runs.ts";
import { sessionInfo } from "./session-info.ts";
import {
  MAIN,
  STALE,
  attempt,
  commit,
  liveRuns,
  put,
  readInbox,
  requireSession,
  sessionEvent,
} from "./session-state.ts";

/**
 * Returns a session: its main head plus heads, runs, receipts, parts and
 * session management.
 *
 * **Details**
 *
 * Heads and children are reads: `info().heads`, `view.heads`,
 * `view.background`, `sessions.list({ parents: { kind: "children", session } })`.
 *
 * @category sessions
 * @since 0.1.0
 */
export interface Session extends Head {
  readonly id: SessionId;
  /**
   * Returns a handle on a named head; "main" is this session.
   *
   * @handle
   */
  head(name: HeadName): Head;
  /** Creates, merges and removes heads. */
  readonly heads: {
    /**
     * Creates a head; `from` defaults to the parent's tip.
     *
     * @returns {@link CreateHeadOutcome}
     * @authority participant
     */
    create(name: HeadName, input?: { readonly from?: Position }): Promise<CreateHeadOutcome>;
    /**
     * Merges a head into its stack parent.
     *
     * @returns {@link MergeOutcome}
     * @authority participant
     */
    merge(name: HeadName, options?: { readonly expect?: Revision }): Promise<MergeOutcome>;
    /**
     * Removes a head.
     *
     * @returns {@link RemoveHeadOutcome}
     * @authority participant
     */
    remove(name: HeadName, options?: { readonly expect?: Revision }): Promise<RemoveHeadOutcome>;
  };
  /**
   * Returns a handle on an exact run.
   *
   * @handle
   */
  run(id: RunId): Run;
  /**
   * Returns a handle on any durable command by id: a send, a move, a batch.
   *
   * @handle
   */
  receipt(id: ReceiptId): Receipt<unknown>;
  /**
   * Returns the directory row: parent, workspace, heads, activation.
   *
   * @authority participant
   */
  info(): Promise<SessionInfo>;
  /**
   * Renames, pins, archives or relocates the session.
   *
   * @returns {@link UpdateOutcome}
   * @authority participant
   */
  update(patch: {
    /** Null clears. */
    readonly name?: string | null;
    readonly pinned?: boolean;
    readonly archived?: boolean;
    /** Relocate: the idle tree moves; store and history stay. */
    readonly workspace?: WorkspaceId;
  }): Promise<UpdateOutcome>;
  /**
   * Removes the session.
   *
   * @returns {@link RemoveSessionOutcome}
   * @authority participant
   */
  remove(): Promise<RemoveSessionOutcome>;
  /**
   * Stops that agent: the live run on every head, everything queued
   * withdrawn, parked waits woken stopped.
   *
   * **Details**
   *
   * `run(id).stop()` is one run and nothing else; this is all of it.
   *
   * @authority participant
   */
  stop(): Promise<{ readonly stopped: readonly RunId[]; readonly withdrawn: readonly MessageId[] }>;

  /**
   * Runs a core command by name.
   *
   * **Details**
   *
   * What plugins contributed is `view.catalog`: it changes on hot reload,
   * which is not the client's action, so it is watched, not read. Settings
   * are `configure({ settings })`. The one write with no other door is a
   * command. A command that yields a prompt is sent by core with source
   * action; the client never relays it.
   *
   * **Gotchas**
   *
   * A side "client" command answers `unknown`.
   *
   * @returns {@link CommandOutcome}
   * @authority participant
   */
  command(name: string, args?: Json): Promise<CommandOutcome>;

  /** Core-owned UI state in this session; clients draw it. */
  readonly parts: {
    /**
     * Creates a part from a definition with an initial state and a
     * placement.
     *
     * @throws {SdkError} invalid when `state` fails the definition's schema.
     * @authority participant
     */
    create<K extends PartDefinition>(kind: K, input: { readonly state: PartState<K>; readonly placement: Placement; readonly id?: PartId }): Promise<Part<K>>;
  };
  /**
   * Returns a handle on a part by id.
   *
   * @handle
   */
  part(id: PartId): Part<PartDefinition>;
}

/** Returns a handle on a session for a connection: its main head plus heads, runs, receipts, parts and management. Binds synchronously; no I/O. */
export function sessionHandle(kernel: Kernel, context: ConnectionContext, id: SessionId): Session {
  const need = (operation: string): void =>
    requireAuthority(context.authority, "participant", `session.${operation}`);

  return {
    ...headHandle(kernel, context, id, MAIN),
    id,
    head: (name) => headHandle(kernel, context, id, name),
    heads: {
      async create(name, input) {
        need("heads.create");

        return createHead(kernel, id, name, input);
      },
      async merge(name, options) {
        need("heads.merge");

        return mergeHead(kernel, id, name, options);
      },
      async remove(name, options) {
        need("heads.remove");

        return removeHead(kernel, id, name, options);
      },
    },
    run(run) {
      const handle = runHandle(kernel, id, run);

      return {
        id: run,
        async stop() {
          need("run.stop");

          return handle.stop();
        },
        async settled(options) {
          need("run.settled");

          return handle.settled(options);
        },
      };
    },
    receipt(receipt) {
      const handle = receiptHandle(kernel, id, receipt);

      return {
        id: receipt,
        async status() {
          need("receipt.status");

          return handle.status();
        },
        async settled(options) {
          need("receipt.settled");

          return handle.settled(options);
        },
        async stop() {
          need("receipt.stop");

          return handle.stop();
        },
      };
    },
    async info() {
      need("info");
      const info = await sessionInfo(kernel, id, context.principal);

      if (info === null) throw new SdkError("unknown", `No session has the id ${id}.`);

      return info;
    },
    async update(patch) {
      need("update");

      return update(kernel, id, patch);
    },
    async remove() {
      need("remove");

      return remove(kernel, context, id);
    },
    async stop() {
      need("stop");

      return stop(kernel, id);
    },
    async command(name, args) {
      need("command");

      return kernel.command(id, name, args);
    },
    parts: {
      async create(kind, input) {
        need("parts.create");

        return kernel.parts.create(context, id, kind, input);
      },
    },
    part: (part) => kernel.parts.part(context, id, part),
  };
}

async function update(
  kernel: Kernel,
  session: SessionId,
  patch: Parameters<Session["update"]>[0],
): Promise<UpdateOutcome> {
  return attempt<UpdateOutcome>(`Updating ${session}`, async () => {
    const found = await requireSession(kernel, session);
    const workspace = patch.workspace ?? found.record.workspace;

    if (workspace !== found.record.workspace) {
      const runs = await liveRuns(kernel, session);

      if (runs.length > 0) return { kind: "busy", runs: runs.map((run) => run.record.view.id) };

      if ((await kernel.store.refs.get(workspaceRef(workspace))) === null)
        return { kind: "unknown-workspace" };
    }

    const record: SessionRecord = {
      ...found.record,
      name: patch.name === undefined ? found.record.name : patch.name,
      pinned: patch.pinned ?? found.record.pinned,
      archived: patch.archived ?? found.record.archived,
      workspace,
    };

    const outcome = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel, "session", record),
        expect: found.ref.revision,
        event: await sessionEvent(kernel, record),
      },
    ]);

    return outcome.kind === "set" ? { kind: "updated" } : STALE;
  });
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
    await kernel.closePlugins(session);

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
