import { asId } from "@nyte-ai/schema";
import type { Configuration, ConfigurationPatch, Cursor, Paged, ParentFilter, PromptOverride, RefUpdate, SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/schema";
import { listSessions, watchSessions } from "./directory.ts";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { requireAuthority } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import type { SessionRecord } from "./records.ts";
import { sessionRef, workspaceRef } from "./refs.ts";
import { sessionHandle } from "./session.ts";
import type { Session } from "./session.ts";
import { MAIN, commit, put, readSession, requireSession, sessionEvent } from "./session-state.ts";

/**
 * Creates, lists and watches the session directory.
 *
 * @category sessions
 * @since 0.1.0
 */
export interface Sessions {
  /**
   * Yields the directory as it changes: the sidebar.
   *
   * @stream watch
   * @authority participant
   */
  watch(input?: { readonly parents?: ParentFilter; readonly limit?: number }): AsyncIterable<readonly SessionInfo[]>;
  /**
   * Creates a durable session and returns its handle.
   *
   * **Details**
   *
   * Children and workspaces:
   *
   * - `create({ parent })` inherits the parent's workspace.
   * - `create({ parent, workspace })` must name a registered workspace.
   * - a tool's `invocation.workspace` is the session's; a tool cannot reach
   *   another folder's files without a registered workspace id.
   *
   * **Gotchas**
   *
   * A subagent sent to folder 2 when only folder 1 is registered: create
   * throws `unknown`. Nothing asks; never a dialog; the parent reports it.
   *
   * @throws {SdkError} unknown when `workspace` is not registered on this host.
   * @authority participant
   */
  create(input?: {
    /** Only to retry across your own restart. */
    readonly id?: SessionId;
    readonly name?: string;
    readonly workspace?: WorkspaceId;
    /** A child is a session with lineage, nothing more. */
    readonly parent?: SessionId;
    readonly configuration?: Configuration | ConfigurationPatch;
    /** This session's own system prompt section: a subagent's role, without a registered agent. */
    readonly prompt?: PromptOverride;
  }): Promise<Session>;
  /**
   * Returns one page of the directory.
   *
   * **Details**
   *
   * The directory is metadata and small; search and archived filtering are
   * the client's, over what `list()` and `watch()` give it.
   *
   * @authority participant
   */
  list(input?: {
    readonly parents?: ParentFilter;
    readonly cursor?: Cursor;
    readonly limit?: number;
  }): Promise<Paged<SessionInfo>>;
}

/** Returns the session directory for a connection; every session it creates records `context.origin`, the run, head and call a tool invocation creates children from. */
export function createSessions(kernel: Kernel, context: ConnectionContext): Sessions {
  const need = (operation: string): void =>
    requireAuthority(context.authority, "participant", `sessions.${operation}`);

  return {
    watch(input) {
      need("watch");

      return watchSessions(kernel, context.principal, input);
    },
    async create(input) {
      need("create");

      return sessionHandle(kernel, context, await create(kernel, context, input ?? {}));
    },
    async list(input) {
      need("list");

      return listSessions(kernel, context.principal, input);
    },
  };
}

async function create(
  kernel: Kernel,
  context: ConnectionContext,
  input: NonNullable<Parameters<Sessions["create"]>[0]>,
): Promise<SessionId> {
  const id = input.id ?? asId<"session">(crypto.randomUUID());

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
    origin: context.origin,
    workspace,
    pinned: false,
    archived: false,
    createdAt: at,
    lastActivityAt: at,
    heads: [{ name: MAIN, stack: null, selected, lastRun: null }],
    prompt: input.prompt ?? null,
  };

  const target = await put(kernel, "session", record, at);

  const configured: readonly RefUpdate[] =
    selected === null
      ? []
      : [
          {
            name: sessionRef(id),
            target,
            event: { head: MAIN, kind: "configured", selected, effective: selected },
          },
        ];

  await commit(kernel, [
    { name: sessionRef(id), target, expect: "absent", event: await sessionEvent(kernel, record) },
    ...configured,
  ]);

  return id;
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
  });

  if (result.kind === "exact") return result;

  throw new SdkError("invalid", `The configuration is ${result.kind}.`, {
    issues: result.kind === "invalid" ? result.issues : [],
  });
}
