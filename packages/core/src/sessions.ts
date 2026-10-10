import type { Configuration, ConfigurationPatch, Cursor, Paged, ParentFilter, PromptOverride, SessionId, SessionInfo, WorkspaceId } from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { ConnectionContext } from "./principals.ts";
import type { Session } from "./session.ts";

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
  throw new Error("not implemented");
}
