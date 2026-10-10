import type {
  CommandOutcome,
  CreateHeadOutcome,
  HeadName,
  Json,
  MergeOutcome,
  MessageId,
  PartId,
  Placement,
  Position,
  ReceiptId,
  RemoveHeadOutcome,
  RemoveSessionOutcome,
  Revision,
  RunId,
  SessionId,
  SessionInfo,
  UpdateOutcome,
  WorkspaceId,
} from "@nyte-ai/schema";
import type { Head } from "./head.ts";
import type { Part, PartDefinition, PartState } from "./parts.ts";
import type { Receipt } from "./receipt.ts";
import type { Run } from "./run.ts";

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
