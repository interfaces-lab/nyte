import type {
  CommandOutcome,
  Configuration,
  ConfigurationPatch,
  ConfigureOutcome,
  CreateHeadOutcome,
  Cursor,
  HeadName,
  Json,
  MergeOutcome,
  Message,
  MessageId,
  MoveOptions,
  MoveOutcome,
  Paged,
  ParentFilter,
  PartId,
  Placement,
  Position,
  PromptOverride,
  ReceiptId,
  RemoveHeadOutcome,
  RemoveSessionOutcome,
  RequestOptions,
  Revision,
  RunEnd,
  RunId,
  SendOptions,
  SessionId,
  SessionInfo,
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

  stop(): Promise<{ readonly stopped: readonly RunId[]; readonly withdrawn: readonly MessageId[] }>;

  command(name: string, args?: Json): Promise<CommandOutcome>;
  readonly parts: {
    create<K extends PartDefinition>(
      kind: K,
      input: { readonly state: PartState<K>; readonly placement: Placement; readonly id?: PartId },
    ): Promise<Part<K>>;
  };

  part(id: PartId): Part<PartDefinition>;
}

export interface Sessions {
  watch(input?: {
    readonly parents?: ParentFilter;
    readonly limit?: number;
  }): AsyncIterable<readonly SessionInfo[]>;

  create(input?: {
    readonly id?: SessionId;
    readonly name?: string;
    readonly workspace?: WorkspaceId;
    readonly parent?: SessionId;
    readonly configuration?: Configuration | ConfigurationPatch;
    readonly prompt?: PromptOverride;
  }): Promise<Session>;

  list(input?: {
    readonly parents?: ParentFilter;
    readonly cursor?: Cursor;
    readonly limit?: number;
  }): Promise<Paged<SessionInfo>>;
}

export interface Head {
  readonly sessionId: SessionId;
  readonly name: HeadName;

  send(content: UserContent, options?: SendOptions): Promise<SendReceipt>;

  configure(patch: ConfigurationPatch): Promise<ConfigureOutcome>;

  view(options?: ViewOptions): Promise<SessionView>;

  watch(options?: ViewOptions): AsyncIterable<SessionView>;

  history(input: {
    readonly before: MessageId;
    readonly limit: number;
  }): Promise<readonly Message[]>;

  tree(): Promise<TreeView>;

  move(position: Position, options?: MoveOptions): Promise<Receipt<MoveOutcome>>;

  compact(input?: {
    readonly instructions?: string;
  }): Promise<
    | { readonly kind: "started"; readonly message: MessageId }
    | { readonly kind: "busy"; readonly run: RunId }
    | { readonly kind: "nothing-to-compact" }
  >;
}
