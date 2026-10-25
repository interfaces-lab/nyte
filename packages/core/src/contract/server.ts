import type {
  Authority,
  BatchOutcome,
  Disposer,
  ExecutionCoverage,
  HeadName,
  HoldLease,
  HostId,
  HostView,
  JobId,
  JobView,
  MessageId,
  MoveOptions,
  MoveOutcome,
  Owned,
  PageId,
  Position,
  PrincipalId,
  ReceiptId,
  Revision,
  SessionId,
  WorkspaceId,
} from "@nyte-ai/schema";
import type {
  Connection,
  ConnectionContext,
  ConnectionRegistry,
  Host,
  OpenOptions,
} from "./host.ts";
import type { PartDefinition } from "./parts.ts";
import type { Plugin } from "./plugin.ts";
import type { Receipt, SendReceipt } from "./session.ts";
import type { BatchEntry, FilesApi, Page, PageTable } from "./workspace.ts";

/** A principal a credential authenticates as, with the authority it holds. */
export type Verdict = {
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
};

/**
 * What a server in front of a composed host needs beyond the public {@link Host}: connections it
 * opens for principals it authenticated, the credentials it checks, the execution it drives, the
 * plugin rows it reports, and the wire's operations that name a host table or carry the client's id
 * (§40o). A server depends on this port, never on the kernel behind it.
 */
export interface ServerHost {
  readonly hostId: HostId;

  /** How the kernel runs sessions: `run` drives its coverage in process, `admit-only` admits and leaves driving to a listener or another process, `dispatch` hands each wake to its dispatcher. */
  readonly execution: NonNullable<OpenOptions["execution"]>;

  /** Opens a connection for a principal the server authenticated. */
  connect(context: ConnectionContext): Connection;

  /** Holds a principal's open connections, which a revoke closes. */
  readonly connections: ConnectionRegistry;

  /** The principal a device token was issued to, or null when no principal holds it. */
  authenticate(token: string): Promise<Verdict | null>;

  /** Redeems a pairing code into a new device token; null when the code is unknown or expired. */
  redeem(code: string): Promise<(Verdict & { readonly token: string }) | null>;

  /** The revision of the host's principals, which every pairing and revoke moves; null before the first. */
  principalsRevision(): Promise<Revision | null>;

  /** Calls `listener` each time the store poll sees another process's commit. */
  onExternalCommit(listener: () => void): Disposer;

  /** Drives the covered sessions' runs in this process, for a listener over an `admit-only` kernel. */
  drive(coverage: ExecutionCoverage): Owned;

  /** Resolves the waits whose deadline has passed at `now`. */
  tick(now: number): Promise<void>;

  /** Calls `listener` each time a session's head has work to drive. */
  onWake(listener: (session: SessionId, head: HeadName) => void): Disposer;

  /** Puts a plugin file's load row on the host view, replacing the row with its id. */
  report(row: HostView["plugins"][number]): void;

  /** The plugin rows the host view shows now. */
  pluginRows(): readonly HostView["plugins"][number][];

  /** Whether `plugin` is among the host's loaded plugins. */
  loaded(plugin: Plugin<"core">): boolean;

  readonly wire: WireHost;
}

/** The operations behind wire rows that carry a client-chosen receipt id or name a page, job or part kind by its wire id (§40o, §40x). */
export interface WireHost {
  /** Moves a session's head under the receipt id the client chose. */
  move(
    session: SessionId,
    head: HeadName,
    position: Position,
    options: MoveOptions & { readonly id?: ReceiptId },
  ): Promise<Receipt<MoveOutcome>>;

  hold(session: SessionId, head: HeadName, message: MessageId): Promise<HoldLease>;

  release(session: SessionId, head: HeadName, message: MessageId): Promise<void>;

  /** Applies a file batch to a workspace under the receipt id the client chose. */
  batch(
    workspace: WorkspaceId,
    files: FilesApi,
    entries: readonly BatchEntry[],
    id?: ReceiptId,
  ): Promise<Receipt<BatchOutcome>>;

  /** The receipt of a batch this process still holds, which belongs to no session. */
  batchReceipt(id: ReceiptId): Receipt<BatchOutcome> | undefined;

  /** The receipt of a send in a session. */
  sendReceipt(session: SessionId, id: ReceiptId): SendReceipt;

  /** A page this host holds open, by its wire id. */
  page(id: PageId): Page | undefined;

  /** How many holders keep a page open. */
  holders(id: PageId): number;

  /** Opens a page once per client-chosen id. */
  openPage(request: Parameters<PageTable["open"]>[0]): Promise<Page>;

  /** A job's view by its wire id, or undefined once the job is gone. */
  job(id: JobId): JobView | undefined;

  /** The part definition registered under `kind` in a session, once its plugins are loaded. */
  partDefinition(session: SessionId, kind: string): Promise<PartDefinition | undefined>;
}

/** A composed host and the server port in front of it. */
export type ServedHost = Omit<Host, "listen"> & { readonly server: ServerHost };
