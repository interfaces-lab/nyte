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

  readonly execution: NonNullable<OpenOptions["execution"]>;

  connect(context: ConnectionContext): Connection;

  readonly connections: ConnectionRegistry;

  authenticate(token: string): Promise<Verdict | null>;

  redeem(code: string): Promise<(Verdict & { readonly token: string }) | null>;

  principalsRevision(): Promise<Revision | null>;

  onExternalCommit(listener: () => void): Disposer;

  drive(coverage: ExecutionCoverage): Owned;

  tick(now: number): Promise<void>;

  onWake(listener: (session: SessionId, head: HeadName) => void): Disposer;

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

  batchReceipt(id: ReceiptId): Receipt<BatchOutcome> | undefined;

  sendReceipt(session: SessionId, id: ReceiptId): SendReceipt;

  page(id: PageId): Page | undefined;

  holders(id: PageId): number;

  openPage(request: Parameters<PageTable["open"]>[0]): Promise<Page>;

  job(id: JobId): JobView | undefined;

  partDefinition(session: SessionId, kind: string): Promise<PartDefinition | undefined>;

  attach(session: SessionId, principal: PrincipalId): SessionAttachment;

  sessions(principal: PrincipalId): AsyncIterable<SessionsChange>;
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
