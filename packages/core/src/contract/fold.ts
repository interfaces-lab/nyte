import type {
  Activation,
  BackgroundItem,
  CallId,
  CatalogId,
  CommitId,
  ContextView,
  Delivery,
  Disposer,
  FileChange,
  HeadInfo,
  HeadName,
  Message,
  MessageId,
  MessageSource,
  PartId,
  PartView,
  PatchEvent,
  PrincipalId,
  Revision,
  RunId,
  RunView,
  Schedule,
  Seq,
  SessionEvent,
  SessionId,
  SessionView,
  ToolClass,
  ToolProgress,
  TurnId,
  TurnInfo,
  Usage,
  UserContent,
  WaitTarget,
} from "@nyte-ai/schema";
import type { CommitRecord, PartRecord } from "./records.ts";

export interface FoldState {
  readonly [INDEX]: Index;
  readonly session: SessionId;

  readonly principal: PrincipalId;

  readonly seen: ReadonlyMap<PrincipalId, ReadonlyMap<HeadName, CommitId | null>>;

  readonly seq: Seq;
  readonly base: Seq;
  readonly activation: Activation;
  readonly catalogId: CatalogId | null;

  readonly changes: readonly FileChange[];
  readonly heads: ReadonlyMap<HeadName, FoldHead>;

  readonly headInfos: readonly HeadInfo[];
  readonly commits: ReadonlyMap<CommitId, CommitRecord>;

  readonly siblings: ReadonlyMap<CommitId | null, readonly CommitId[]>;
  readonly inputs: ReadonlyMap<MessageId, FoldInput>;
  readonly parts: ReadonlyMap<PartId, PartRecord>;

  readonly partViews: readonly PartView[];
  readonly runs: ReadonlyMap<RunId, FoldRun>;
  readonly calls: ReadonlyMap<CallId, FoldCall>;
  readonly turns: ReadonlyMap<TurnId, FoldTurn>;

  readonly messages: ReadonlyMap<MessageId, Message>;
}

export interface FoldHead {
  readonly info: HeadInfo;

  readonly revision: Revision | null;

  readonly messages: readonly Message[];

  readonly live: readonly PartId[];

  readonly pending: readonly MessageId[];

  readonly turns: readonly TurnInfo[];
  readonly background: readonly BackgroundItem[];
  readonly configuration: SessionView["configuration"];
  readonly context: ContextView;
}

export interface FoldInput {
  readonly id: MessageId;
  readonly head: HeadName;
  readonly at: number;
  readonly content: UserContent;
  readonly source: MessageSource;
  readonly delivery: Delivery;
  readonly schedule: Schedule;
  readonly covered: boolean;
  readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null;
  readonly requires: readonly string[] | null;
  readonly landed: { readonly commit: CommitId; readonly run: RunId | null } | null;
}

export interface FoldRun {
  readonly view: RunView;
  readonly turn: TurnId;
}

interface FoldCall {
  readonly part: PartId;
  readonly class: ToolClass;
  readonly waiting: WaitTarget | null;
  readonly settled: boolean;
}

export interface FoldTurn {
  readonly info: TurnInfo;
  readonly head: HeadName;

  readonly live: readonly CallId[];
}

export type Logged<Kind extends SessionEvent["kind"]> = Extract<
  SessionEvent,
  { readonly kind: Kind }
>;

export interface Index {
  readonly heads: Map<HeadName, FoldHead>;
  readonly commits: Map<CommitId, CommitRecord>;
  readonly siblings: Map<CommitId | null, readonly CommitId[]>;
  readonly inputs: Map<MessageId, FoldInput>;
  readonly parts: Map<PartId, PartRecord>;
  readonly unsettled: Set<PartId>;
  readonly runs: Map<RunId, FoldRun>;
  readonly calls: Map<CallId, FoldCall>;
  readonly turns: Map<TurnId, FoldTurn>;
  readonly messages: Map<MessageId, Message>;
  readonly byRun: Map<RunId, PartId[]>;

  readonly riders: Set<MessageId>;

  readonly thinking: Map<TurnId, number>;
  readonly paths: Map<HeadName, Path>;

  readonly stamps: Readonly<Record<Table, Map<string, Seq>>>;
  readonly ring: Ring;
}

export type Table =
  | "messages"
  | "turns"
  | "parts"
  | "changes"
  | "catalog"
  | "heads"
  | "settings"
  | "usage"
  | "background";

export interface Touched {
  readonly upsert: Readonly<Record<Table, Set<string>>>;
  readonly drop: Readonly<Record<Table, Set<string>>>;
  readonly paths: Map<HeadName, number>;
}

export interface Step extends Touched {
  readonly seq: Seq;
  readonly mark: number;
}

export interface Ring {
  readonly steps: Step[];
  from: Seq;
  mark: number;
}

export interface ChangeCursor {
  readonly seq: Seq;
  readonly mark: number;
}

export interface Path {
  readonly messages: Message[];

  committed: number;
  readonly at: Map<MessageId, number>;
  readonly turns: TurnInfo[];
  readonly turnAt: Map<TurnId, number>;

  readonly firstAt: number[];
  readonly usage: Usage[];
  readonly edits: { readonly seq: Seq; readonly position: number }[];
}

export interface Draft extends Index {
  seen: ReadonlyMap<PrincipalId, ReadonlyMap<HeadName, CommitId | null>>;
  seq: Seq;
  activation: Activation;
  catalogId: CatalogId | null;
  changes: readonly FileChange[];
  partViews: readonly PartView[];

  readonly walk: Set<HeadName>;
  readonly appended: Map<HeadName, CommitId>;

  readonly rebuild: Set<HeadName>;
  readonly swapped: Set<MessageId>;
  readonly retitled: Set<TurnId>;

  readonly steps: Map<TurnId, { steps: number; thinking: number }>;

  readonly durable: boolean;
  readonly touched: Touched;
}

export const INDEX = Symbol("fold-index");

export interface HeadPair {
  readonly tip: CommitId | null;
  readonly revision: Revision;
}

export interface FeedItem {
  readonly event: SessionEvent | PatchEvent;
  readonly head: HeadPair | null;
}

export interface LoggedItem {
  readonly event: SessionEvent;
  readonly head: HeadPair | null;
}

export interface LogPublisher {
  publish(session: SessionId, items: readonly LoggedItem[]): Promise<void>;
  logged(session: SessionId, from: number, through: number): void;
  loggedThrough(session: SessionId): number;
}

export interface SessionBus {
  publish(session: SessionId, event: SessionEvent | PatchEvent, head?: HeadPair | null): void;
  subscribe(
    session: SessionId,
    listener: (event: SessionEvent | PatchEvent, head: HeadPair | null) => void,
  ): Disposer;
  subscribeAll(listener: (session: SessionId, event: SessionEvent | PatchEvent) => void): Disposer;
  watched(session: SessionId): boolean;
  onUnwatched(listener: (session: SessionId) => void): Disposer;
}

export interface FoldCache {
  acquire(
    session: SessionId,
    principal: PrincipalId,
  ): {
    ready(): Promise<void>;

    state(): FoldState;
    subscribe(listener: (state: FoldState) => void): Disposer;
    release(): void;
  };

  folding(session: SessionId): boolean;

  refresh(): Promise<void>;

  close(): Promise<void>;
}

export interface LiveStream {
  readonly run: RunId | null;
  readonly markdown: string | null;
  readonly progress: ToolProgress | null;
}
