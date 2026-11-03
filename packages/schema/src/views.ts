import { Type } from "typebox";
import type { TSchema } from "typebox";
import { ConfigurationType } from "./configuration.ts";
import { FileChangeType } from "./files.ts";
import { idSchema, SeqType } from "./ids.ts";
import { withJson } from "./json.ts";
import {
  DeliveryType,
  MessageSourceType,
  ScheduleType,
  UserContentType,
  WaitingScheduleType,
} from "./messages.ts";
import { ContextViewType, UsageType } from "./models.ts";
import { PartStatusType, PartViewType } from "./parts.ts";
import { BackgroundItemType, ExecutionType, RunEndType, WaitTargetType } from "./runs.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import {
  AgentInfoType,
  CommandInfoType,
  HeadInfoType,
  SessionCatalogViewType,
  SettingInfoType,
  SkillInfoType,
  ToolInfoType,
} from "./sessions.ts";
import { nullable } from "./wire/nullable.ts";
import { ActivationType } from "./workspaces.ts";

const CLASS_SUMMARY = Type.Object({ count: Type.Number(), paths: Type.Array(Type.String()) });

const MESSAGE = { id: idSchema<"message">(), turn: idSchema<"turn">(), at: Type.Number() };

export const ViewOptionsType = Type.Object({ tail: Type.Optional(Type.Number()) });

export type ViewOptions = Decoded<typeof ViewOptionsType>;

const UnsentStatusType = Type.Object({
  kind: Type.Literal("unsent"),
  attempts: Type.Number(),
  retrying: nullable(Type.Object({ at: Type.Number(), reason: Type.String() })),
});

const PendingStatusType = Type.Object({
  kind: Type.Literal("pending"),
  schedule: ScheduleType,
  covered: Type.Boolean(),
});

export const UserStatusType = Type.Union([
  UnsentStatusType,
  PendingStatusType,
  Type.Object({
    kind: Type.Literal("landed"),
    commit: idSchema<"commit">(),
    run: nullable(idSchema<"run">()),
    replaced: nullable(
      Type.Object({ previous: idSchema<"message">(), stopped: nullable(idSchema<"run">()) }),
    ),
  }),
]);

export type UserStatus = Decoded<typeof UserStatusType>;

const UserMessageType = Type.Object({
  ...MESSAGE,
  kind: Type.Literal("user"),
  content: UserContentType,
  source: MessageSourceType,
  delivery: DeliveryType,
  status: UserStatusType,
  siblings: Type.Object({
    index: Type.Number(),
    count: Type.Number(),
    ids: Type.Array(idSchema<"commit">()),
  }),
});

const QueuedMessageType = Type.Object({
  ...UserMessageType.properties,
  status: Type.Union([
    UnsentStatusType,
    Type.Object({ ...PendingStatusType.properties, schedule: WaitingScheduleType }),
  ]),
});

export type QueuedMessage = Decoded<typeof QueuedMessageType>;

export const MessageType = Type.Union([
  UserMessageType,
  Type.Object({
    ...MESSAGE,
    kind: Type.Literal("part"),
    part: idSchema<"part">(),
    partKind: Type.String(),
    role: Type.Enum(["step", "answer", "note"]),
    state: Type.Unknown(),
    version: Type.Number(),
    status: PartStatusType,
  }),
]);

export type Message = Decoded<typeof MessageType>;

export const TurnInfoType = Type.Object({
  id: idSchema<"turn">(),
  run: nullable(idSchema<"run">()),
  prompt: nullable(idSchema<"message">()),
  state: Type.Union([
    Type.Object({ kind: Type.Literal("working"), activity: nullable(Type.String()) }),
    Type.Object({ kind: Type.Literal("waiting"), on: WaitTargetType }),
    Type.Object({ kind: Type.Literal("ended"), end: RunEndType }),
  ]),
  startedAt: Type.Number(),
  endedAt: nullable(Type.Number()),
  steps: Type.Number(),
  thinkingOnly: Type.Boolean(),
  summary: Type.Object({
    byClass: Type.Object({
      read: CLASS_SUMMARY,
      list: CLASS_SUMMARY,
      edit: CLASS_SUMMARY,
      shell: CLASS_SUMMARY,
      delegate: CLASS_SUMMARY,
      custom: CLASS_SUMMARY,
    }),
    failed: Type.Number(),
    stopped: Type.Number(),
    added: Type.Number(),
    removed: Type.Number(),
  }),
});

export type TurnInfo = Decoded<typeof TurnInfoType>;

export const SessionViewType = Type.Object({
  revision: nullable(idSchema<"revision">()),
  seq: SeqType,
  activation: ActivationType,
  messages: Type.Array(MessageType),
  queue: Type.Array(QueuedMessageType),
  leadingPrompt: nullable(UserMessageType),
  parts: Type.Array(PartViewType),
  turns: Type.Array(TurnInfoType),
  usage: UsageType,
  execution: ExecutionType,
  reportsHeld: Type.Boolean(),
  background: Type.Array(BackgroundItemType),
  configuration: Type.Object({
    selected: nullable(ConfigurationType),
    effective: nullable(ConfigurationType),
  }),
  context: ContextViewType,
  heads: Type.Array(HeadInfoType),
  changes: Type.Array(FileChangeType),
  catalog: SessionCatalogViewType,
  seenThrough: nullable(Type.Number()),
});

/** A head's view: its last `tail` messages, at most `tail` and contiguous; `leadingPrompt`, the prompt of the earliest turn among them when that prompt is before them, else null; the turns those messages belong to from the earliest one on (older turns and the messages between `leadingPrompt` and `messages` arrive through `head.history`); `usage`, the sum of every completed run on the head's history; and `seenThrough`, the time of the commit the viewing principal last saw on this head, or null before it saw one: a message whose `at` is after it arrived unseen. */
export type SessionView = Decoded<typeof SessionViewType>;

export const HistoryPageType = Type.Object({
  messages: Type.Array(MessageType),
  leadingPrompt: nullable(UserMessageType),
  turns: Type.Array(TurnInfoType),
});

/** Messages before a view's window, with the turns they belong to and `leadingPrompt`, the prompt of the earliest of those turns when it is before `messages`, else null. */
export type HistoryPage = Decoded<typeof HistoryPageType>;

export const HeadRowType = Type.Object({
  name: idSchema<"head">(),
  revision: nullable(idSchema<"revision">()),
  execution: ExecutionType,
  reportsHeld: Type.Boolean(),
  seenThrough: nullable(Type.Number()),
  queue: Type.Array(idSchema<"message">()),
});

export type HeadRow = Decoded<typeof HeadRowType>;

export const HeadSettingsRowType = Type.Object({
  name: idSchema<"head">(),
  configuration: Type.Object({
    selected: nullable(ConfigurationType),
    effective: nullable(ConfigurationType),
  }),
  context: ContextViewType,
});

export type HeadSettingsRow = Decoded<typeof HeadSettingsRowType>;

export const HeadUsageRowType = Type.Object({
  name: idSchema<"head">(),
  usage: UsageType,
});

export type HeadUsageRow = Decoded<typeof HeadUsageRowType>;

export const BackgroundRowType = Type.Object({
  head: idSchema<"head">(),
  item: BackgroundItemType,
});

export type BackgroundRow = Decoded<typeof BackgroundRowType>;

export const CatalogRowType = Type.Union([
  Type.Object({ kind: Type.Literal("commands"), entry: CommandInfoType }),
  Type.Object({ kind: Type.Literal("settings"), entry: SettingInfoType }),
  Type.Object({ kind: Type.Literal("skills"), entry: SkillInfoType }),
  Type.Object({ kind: Type.Literal("agents"), entry: AgentInfoType }),
  Type.Object({ kind: Type.Literal("tools"), entry: ToolInfoType }),
]);

export type CatalogRow = Decoded<typeof CatalogRowType>;

function tableChange<T extends TSchema>(row: T) {
  return Type.Object({ upsert: Type.Array(row), drop: Type.Array(Type.String()) });
}

export const TableChangesType = Type.Object({
  messages: tableChange(MessageType),
  turns: tableChange(TurnInfoType),
  parts: tableChange(PartViewType),
  changes: tableChange(FileChangeType),
  catalog: tableChange(CatalogRowType),
  heads: tableChange(HeadRowType),
  settings: tableChange(HeadSettingsRowType),
  usage: tableChange(HeadUsageRowType),
  background: tableChange(BackgroundRowType),
});

export type TableChanges = Decoded<typeof TableChangesType>;

export const PathChangeType = Type.Object({
  head: idSchema<"head">(),
  after: nullable(idSchema<"message">()),
  ids: Type.Array(idSchema<"message">()),
});

export type PathChange = Decoded<typeof PathChangeType>;

export const SessionChangeType = Type.Object({
  seq: SeqType,
  tables: Type.Partial(TableChangesType),
  paths: Type.Array(PathChangeType),
});

export type SessionChange = Decoded<typeof SessionChangeType>;

export const WindowSpecType = Type.Union([
  Type.Object({ tail: Type.Number() }),
  Type.Object({ from: idSchema<"message">() }),
]);

export type WindowSpec = Decoded<typeof WindowSpecType>;

export const ResumeType = Type.Object({
  seq: SeqType,
  from: nullable(idSchema<"message">()),
});

export type Resume = Decoded<typeof ResumeType>;

export const HeadWindowType = Type.Object({
  seq: SeqType,
  head: idSchema<"head">(),
  order: Type.Array(idSchema<"message">()),
  leadingPrompt: nullable(idSchema<"message">()),
  complete: Type.Boolean(),
  tables: TableChangesType,
  live: Type.Object({ activation: ActivationType }),
});

export type HeadWindow = Decoded<typeof HeadWindowType>;

export function catalogRowKey(row: CatalogRow): string {
  switch (row.kind) {
    case "settings":
    case "agents":
      return `${row.kind}/${row.entry.id}`;
    default:
      return `${row.kind}/${row.entry.name}`;
  }
}

export function backgroundRowKey(row: BackgroundRow): string {
  return `${row.head}/${row.item.kind}/${row.item.id}`;
}

export const ViewOptionsSchema: Schema<ViewOptions> = standard(ViewOptionsType);

export const UserStatusSchema: Schema<UserStatus> = standard(UserStatusType);

export const MessageSchema: Schema<Message> = standard(MessageType);

export const TurnInfoSchema: Schema<TurnInfo> = standard(TurnInfoType);

export const SessionViewSchema: Schema<SessionView> = standard(withJson(SessionViewType));

export const HistoryPageSchema: Schema<HistoryPage> = standard(withJson(HistoryPageType));
