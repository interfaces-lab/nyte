import type {
  Activation,
  BackgroundItem,
  CallId,
  CommitId,
  Configuration,
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
  SessionCatalogView,
  SessionEvent,
  SessionId,
  SessionView,
  ToolClass,
  ToolProgress,
  TurnId,
  TurnInfo,
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
  readonly activation: Activation;
  readonly catalog: SessionCatalogView;

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
  readonly configuration: Configuration;
  readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null;
  readonly landed: { readonly commit: CommitId; readonly run: RunId | null } | null;
}

export interface FoldRun {
  readonly view: RunView;
  readonly turn: TurnId;
}

export interface FoldCall {
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

export type UserMessage = Extract<Message, { readonly kind: "user" }>;

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
  readonly runs: Map<RunId, FoldRun>;
  readonly calls: Map<CallId, FoldCall>;
  readonly turns: Map<TurnId, FoldTurn>;
  readonly messages: Map<MessageId, Message>;
  readonly byRun: Map<RunId, PartId[]>;

  readonly riders: Set<MessageId>;

  readonly thinking: Map<TurnId, number>;
  readonly paths: Map<HeadName, Path>;
}

export interface Path {
  readonly messages: Message[];

  committed: number;
  readonly at: Map<MessageId, number>;
  readonly turns: TurnInfo[];
  readonly turnAt: Map<TurnId, number>;

  readonly firstAt: number[];
}

export interface Draft extends Index {
  seen: ReadonlyMap<PrincipalId, ReadonlyMap<HeadName, CommitId | null>>;
  seq: Seq;
  activation: Activation;
  catalog: SessionCatalogView;
  changes: readonly FileChange[];
  partViews: readonly PartView[];

  readonly walk: Set<HeadName>;
  readonly appended: Map<HeadName, CommitId>;

  readonly rebuild: Set<HeadName>;
  readonly swapped: Set<MessageId>;
  readonly retitled: Set<TurnId>;

  readonly steps: Map<TurnId, { steps: number; thinking: number }>;
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

/** A logged event with its head's ref pair when it moves a head. */
export interface LoggedItem {
  readonly event: SessionEvent;
  readonly head: HeadPair | null;
}

/**
 * Puts logged events on the bus once each and in seq order per session, for every subscriber.
 * An event at or below the session's last published seq is dropped; one past the next seq first
 * publishes the gap from the log (another process's commits, or a concurrent publish not yet
 * here), and publishes anyway, leaving the gap to folds' own reads, when that read fails.
 * A session's sequence is dropped once the bus has had no subscriber for it, and this process no
 * event to publish, for a linger; a session logged again after that starts from that write's seqs.
 */
export interface LogPublisher {
  /** Publishes `items`, ascending, after everything handed over for the session before them. */
  publish(session: SessionId, items: readonly LoggedItem[]): Promise<void>;
  /** Notes that this process logged the session's events `from` through `through` in one write, before they reach the bus. */
  logged(session: SessionId, from: number, through: number): void;
  /** The highest seq this process has logged for the session, or 0: a fold behind it has events to read even when no other process committed. */
  loggedThrough(session: SessionId): number;
}

export interface SessionBus {
  publish(session: SessionId, event: SessionEvent | PatchEvent, head?: HeadPair | null): void;
  subscribe(
    session: SessionId,
    listener: (event: SessionEvent | PatchEvent, head: HeadPair | null) => void,
  ): Disposer;
  subscribeAll(listener: (session: SessionId, event: SessionEvent | PatchEvent) => void): Disposer;
  /** Whether any listener is subscribed to the session. */
  watched(session: SessionId): boolean;
  /** Calls `listener` each time a session's last listener unsubscribes. */
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

  /** Whether a fold of the session is held or lingering. */
  folding(session: SessionId): boolean;

  /** Reads each fold's log past it and publishes what it finds on the bus: what another process logged since. */
  refresh(): Promise<void>;
}

export interface LiveStream {
  readonly run: RunId | null;
  readonly markdown: string | null;
  readonly progress: ToolProgress | null;
}
