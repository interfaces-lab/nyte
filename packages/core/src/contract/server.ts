import type {
  Activation,
  Authority,
  BatchOutcome,
  Disposer,
  ExecutionCoverage,
  HeadName,
  HeadWindow,
  HoldLease,
  HostId,
  HostView,
  JobId,
  JobView,
  Json,
  MessageId,
  MoveOptions,
  MoveOutcome,
  Owned,
  PageId,
  PartId,
  PartView,
  Position,
  PrincipalId,
  ReceiptId,
  Resume,
  Revision,
  RunId,
  SessionChange,
  SessionId,
  SessionsChange,
  TailnetStatus,
  WindowSpec,
  WorkspaceId,
} from "@nyte-ai/schema";
import type {
  Connection,
  ConnectionContext,
  ConnectionRegistry,
  Host,
  OpenOptions,
} from "./host.ts";
import type { ChangeCursor } from "./fold.ts";
import type { PartDefinition } from "./parts.ts";
import type { Receipt, SendReceipt } from "./session.ts";
import type { BatchEntry, FilesApi, Page, PageTable } from "./workspace.ts";

export type Verdict = {
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
};

export interface ServerHost {
  readonly hostId: HostId;

  readonly version: string;

  readonly startedAt: number;

  /** How the kernel runs sessions: `run` drives its coverage in process, `admit-only` admits and leaves driving to a listener or another process, `dispatch` hands each wake to its dispatcher. */
  readonly execution: NonNullable<OpenOptions["execution"]>;

  connect(context: ConnectionContext): Connection;

  /** Holds a principal's open connections, which a revoke closes. */
  readonly connections: ConnectionRegistry;

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

  reportTailnet(status: TailnetStatus): void;

  pluginRows(): readonly HostView["plugins"][number][];

  readonly wire: WireHost;
}

export interface WireHost {
  move(
    session: SessionId,
    head: HeadName,
    position: Position,
    options: MoveOptions & { readonly id?: ReceiptId },
  ): Promise<Receipt<MoveOutcome>>;

  hold(session: SessionId, head: HeadName, message: MessageId): Promise<HoldLease>;

  release(session: SessionId, head: HeadName, message: MessageId): Promise<void>;

  batch(
    workspace: WorkspaceId,
    files: FilesApi,
    entries: readonly BatchEntry[],
    id?: ReceiptId,
  ): Promise<Receipt<BatchOutcome>>;

  /** The receipt of a batch this process still holds, which belongs to no session. */
  batchReceipt(id: ReceiptId): Receipt<BatchOutcome> | undefined;

  sendReceipt(session: SessionId, id: ReceiptId): SendReceipt;

  page(id: PageId): Page | undefined;

  holders(id: PageId): number;

  /** Opens a page once per client-chosen id. */
  openPage(request: Parameters<PageTable["open"]>[0]): Promise<Page>;

  job(id: JobId): JobView | undefined;

  /** The part definition registered under `kind` in a session, once its plugins are loaded. */
  partDefinition(session: SessionId, kind: string): Promise<PartDefinition | undefined>;

  attach(session: SessionId, principal: PrincipalId): SessionAttachment;

  sessions(principal: PrincipalId): AsyncIterable<SessionsChange>;

  activations(): ReadonlyMap<SessionId, Activation>;

  onActivation(listener: () => void): Disposer;
}

export interface StreamingPart {
  readonly part: PartId;
  readonly run: RunId | null;
  readonly version: number;
  readonly markdown: string;
}

export interface PartProgress {
  readonly part: PartId;
  readonly run: RunId | null;
  readonly progress: Json;
}

export interface SessionAttachment {
  ready(): Promise<void>;
  cursor(): ChangeCursor;
  activation(): Activation;
  read(head: HeadName, window: WindowSpec, resume: Resume | null): HeadWindow;
  part(id: PartId): PartView | null;
  changesAfter(cursor: ChangeCursor): SessionChange;
  streaming(): readonly StreamingPart[];
  progress(): readonly PartProgress[];
  subscribe(listener: () => void): Disposer;
  release(): void;
}

export type ServedHost = Omit<Host, "listen"> & { readonly server: ServerHost };
