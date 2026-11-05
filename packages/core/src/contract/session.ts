import type {
  CommandCompletion,
  CommandOutcome,
  Configuration,
  ConfigurationPatch,
  CommitId,
  ConfigureOutcome,
  CreateHeadOutcome,
  Cursor,
  ForkOutcome,
  HeadName,
  HistoryPage,
  MergeOutcome,
  MessageId,
  MoveOptions,
  MoveOutcome,
  Paged,
  ParentFilter,
  PartId,
  Placement,
  Position,
  ProjectId,
  PromptOverride,
  ReceiptId,
  RemoveHeadOutcome,
  RemoveSessionOutcome,
  RequestOptions,
  ReviseOptions,
  ReviseOutcome,
  Revision,
  RunEnd,
  RunId,
  SendOptions,
  SessionId,
  SessionInfo,
  SessionsRead,
  SessionView,
  StopOutcome,
  TreeView,
  UpdateOutcome,
  UserContent,
  UserStatus,
  ViewOptions,
  WorkspaceId,
} from "@nyte-ai/schema";
import type { Part, PartDefinition, PartState } from "./parts.ts";

export interface Receipt<Outcome> {
  readonly id: ReceiptId;

  status(): Promise<
    | { readonly kind: "pending" }
    | { readonly kind: "settled"; readonly outcome: Outcome }
    | { readonly kind: "missing" }
  >;

  settled(options?: RequestOptions): Promise<Outcome>;

  stop(): Promise<StopOutcome<Outcome>>;
}

export interface SendReceipt extends Receipt<
  RunEnd | { readonly kind: "withdrawn" } | Exclude<MoveOutcome, { readonly kind: "moved" }>
> {
  readonly message: MessageId;

  landed(): Promise<
    | Extract<UserStatus, { readonly kind: "landed" }>
    | { readonly kind: "withdrawn" }
    | Exclude<MoveOutcome, { readonly kind: "moved" }>
  >;
}

export type ReleaseOutcome = { readonly kind: "released" } | { readonly kind: "lapsing" };

export interface HeldMessage {
  readonly kind: "held";
  readonly message: MessageId;
  readonly lost: Promise<
    { readonly kind: "sent" } | { readonly kind: "missing" } | { readonly kind: "lapsed" }
  >;

  save(content: UserContent, options?: ReviseOptions): Promise<ReviseOutcome>;

  release(): Promise<ReleaseOutcome>;

  [Symbol.asyncDispose](): Promise<void>;
}

export type HoldOutcome = HeldMessage | { readonly kind: "sent" } | { readonly kind: "missing" };

export const HOLD_MS = 20_000;

export interface Run {
  readonly id: RunId;

  stop(): Promise<StopOutcome<RunEnd>>;

  settled(options?: RequestOptions): Promise<RunEnd>;
}

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

  /** Updates session metadata; identical values succeed without changing the revision or log. */
  update(patch: {
    readonly name?: string | null;
    readonly pinned?: boolean;
    readonly archived?: boolean;
    readonly workspace?: WorkspaceId;
  }): Promise<UpdateOutcome>;

  remove(): Promise<RemoveSessionOutcome>;

  /** Starts a new chat in the same folder with this chat's history through `from`, by default main's tip. The new chat shares the history's stored objects and grows on its own; this chat doesn't change. */
  fork(input?: { readonly from?: CommitId }): Promise<ForkOutcome>;

  stop(): Promise<{ readonly stopped: readonly RunId[]; readonly withdrawn: readonly MessageId[] }>;

  /** Runs plugin command `name` with the text typed after it (`""` for none). */
  command(name: string, text: string): Promise<CommandOutcome>;

  /** Suggests the text after plugin command `name` from `prefix`, what is typed there so far; none for a command that suggests nothing. */
  completeCommand(name: string, prefix: string): Promise<readonly CommandCompletion[]>;
  readonly parts: {
    create<K extends PartDefinition>(
      kind: K,
      input: { readonly state: PartState<K>; readonly placement: Placement; readonly id?: PartId },
    ): Promise<Part<K>>;
  };

  part(id: PartId): Part<PartDefinition>;
}

/** The host's chats: list them, and start one with its first message. */
export interface Sessions {
  /** Starts a chat with its first message. One commit creates the session and admits the message, so no session exists without one; until then a client holds a draft. A person's client's `configuration` is remembered as `Head.configure` remembers it. `id` is minted when absent and names the chat, its first message and its receipt. Pass it to key a draft or to retry: the same id and input return the same start. Other input under that id, or an id naming an existing chat, is refused as invalid. Resolves once the session's before_send hooks decided the message. A refusal, a failing hook, or a stop before the decision removes the session and throws. */
  start(input: {
    readonly id?: SessionId;
    readonly name?: string;
    readonly workspace?: WorkspaceId;
    readonly parent?: SessionId;
    readonly configuration?: Configuration | ConfigurationPatch;
    readonly prompt?: PromptOverride;
    /** `worktree` runs the chat in a git worktree of its workspace on a new branch from HEAD, with the workspace's uncommitted changes copied in; the worktree becomes the chat's workspace, whose `isolation` names its branch. A workspace outside git, or whose provider has no worktrees, is refused with `SdkError("unavailable")`. Removing the chat removes the worktree, keeping its folder while it holds uncommitted changes and its branch once it has commits. */
    readonly isolation?: "worktree";
    /** `false` reads no context files (`AGENTS.md`, `CLAUDE.md` and the like) for the chat: not the user's, the ancestors' or the folder's own. The chat keeps it for good, across reloads, resumes and other hosts. */
    readonly contextFiles?: false;
    /** `true` starts a side chat of `parent`: a chat a person keeps beside it. It never reports to the parent or shows as the parent's background work, and `SessionInfo.side` marks it. Without `parent` it is refused as invalid. */
    readonly side?: true;
    /** Starts the chat as a project's coordinator, in the same commit that names it there. A child starts in its parent's project without it, on the project's agents model unless `configuration` names one, and a side chat in none. A project that is archived, works in another folder, or already has its chat is refused as invalid. */
    readonly project?: ProjectId;
    readonly content: UserContent;
  }): Promise<{ readonly session: Session; readonly receipt: SendReceipt }>;

  list(input?: {
    readonly parents?: ParentFilter;
    readonly cursor?: Cursor;
    readonly limit?: number;
  }): Promise<Paged<SessionInfo>>;

  read(input?: {
    readonly parents?: ParentFilter;
    readonly limit?: number;
    readonly resume?: { readonly seq: number };
  }): Promise<SessionsRead>;
}

export interface Head {
  readonly sessionId: SessionId;
  readonly name: HeadName;

  send(content: UserContent, options?: SendOptions): Promise<SendReceipt>;

  revise(message: MessageId, content: UserContent, options?: ReviseOptions): Promise<ReviseOutcome>;

  hold(message: MessageId): Promise<HoldOutcome>;

  /** A model switch without a level lands on the new model's `defaultThinking`. From a person's client, not a tool call or plugin, an accepted model becomes the default and an accepted level its model's `defaultThinking`. */
  configure(patch: ConfigurationPatch): Promise<ConfigureOutcome>;

  view(options?: ViewOptions): Promise<SessionView>;

  see(commit: CommitId): Promise<void>;

  /** The `limit` messages before `before`, older than the view's window, with the turns they belong to. */
  history(input: { readonly before: MessageId; readonly limit: number }): Promise<HistoryPage>;

  tree(): Promise<TreeView>;

  /** Moves the head to `position`; a user commit lands on its parent and hands its content back. Main never lands before its first message with nothing queued, since the chat would be empty: that move is refused as invalid, and `send(content, { replace })` rewrites the first message in one step instead. */
  move(position: Position, options?: MoveOptions): Promise<Receipt<MoveOutcome>>;

  compact(input?: {
    readonly instructions?: string;
  }): Promise<
    | { readonly kind: "started"; readonly message: MessageId }
    | { readonly kind: "busy"; readonly run: RunId }
    | { readonly kind: "nothing-to-compact" }
  >;
}
