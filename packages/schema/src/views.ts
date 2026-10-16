import { Type } from "typebox";
import type { TSchema } from "typebox";
import { ConfigurationType } from "./configuration.ts";
import { FileChangeType } from "./files.ts";
import { idSchema, SeqType } from "./ids.ts";
import { withJson } from "./json.ts";
import { DeliveryType, MessageSourceType, ScheduleType, UserContentType } from "./messages.ts";
import { ContextViewType } from "./models.ts";
import { PartStatusType, PartViewType } from "./parts.ts";
import { BackgroundItemType, ExecutionType, RunEndType, WaitTargetType } from "./runs.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { HeadInfoType, SessionCatalogViewType } from "./sessions.ts";
import { nullable } from "./wire/nullable.ts";
import { ActivationType } from "./workspaces.ts";

const CLASS_SUMMARY = Type.Object({ count: Type.Number(), paths: Type.Array(Type.String()) });

const MESSAGE = { id: idSchema<"message">(), turn: idSchema<"turn">(), at: Type.Number() };

export const ViewOptionsType = Type.Object({ tail: Type.Optional(Type.Number()) });

export type ViewOptions = Decoded<typeof ViewOptionsType>;

export const UserStatusType = Type.Union([
  Type.Object({
    kind: Type.Literal("unsent"),
    attempts: Type.Number(),
    retrying: nullable(Type.Object({ at: Type.Number(), reason: Type.String() })),
  }),
  Type.Object({ kind: Type.Literal("pending"), schedule: ScheduleType, covered: Type.Boolean() }),
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

export const MessageType = Type.Union([
  Type.Object({
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
  }),
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
  parts: Type.Array(PartViewType),
  turns: Type.Array(TurnInfoType),
  execution: ExecutionType,
  background: Type.Array(BackgroundItemType),
  configuration: Type.Object({
    selected: nullable(ConfigurationType),
    effective: nullable(ConfigurationType),
  }),
  context: ContextViewType,
  heads: Type.Array(HeadInfoType),
  changes: Type.Array(FileChangeType),
  catalog: SessionCatalogViewType,
});

export type SessionView = Decoded<typeof SessionViewType>;

const VIEW = SessionViewType.properties;

function viewSplice<T extends TSchema>(item: T) {
  return Type.Object({ runs: Type.Array(Type.Number()), items: Type.Array(item) });
}

export const ViewFrameType = Type.Union([
  Type.Object({ kind: Type.Literal("view"), view: SessionViewType }),
  Type.Object({
    kind: Type.Literal("delta"),
    seq: SeqType,
    revision: Type.Optional(VIEW.revision),
    activation: Type.Optional(VIEW.activation),
    messages: Type.Optional(viewSplice(MessageType)),
    appends: Type.Optional(
      Type.Array(Type.Object({ at: Type.Number(), append: Type.String(), version: Type.Number() })),
    ),
    parts: Type.Optional(viewSplice(PartViewType)),
    turns: Type.Optional(viewSplice(TurnInfoType)),
    execution: Type.Optional(VIEW.execution),
    background: Type.Optional(viewSplice(BackgroundItemType)),
    configuration: Type.Optional(VIEW.configuration),
    context: Type.Optional(VIEW.context),
    heads: Type.Optional(viewSplice(HeadInfoType)),
    changes: Type.Optional(viewSplice(FileChangeType)),
    catalog: Type.Optional(VIEW.catalog),
  }),
]);

/** One frame of a head's watch on the wire: the whole view first, then each later view as what changed since the frame before it, an absent field unchanged. */
export type ViewFrame = Decoded<typeof ViewFrameType>;

export const ViewOptionsSchema: Schema<ViewOptions> = standard(ViewOptionsType);

export const UserStatusSchema: Schema<UserStatus> = standard(UserStatusType);

export const MessageSchema: Schema<Message> = standard(MessageType);

export const TurnInfoSchema: Schema<TurnInfo> = standard(TurnInfoType);

export const SessionViewSchema: Schema<SessionView> = standard(withJson(SessionViewType));

export const ViewFrameSchema: Schema<ViewFrame> = standard(withJson(ViewFrameType));

/** One array of a view as the previous frame's array spliced: `runs` holds `[from, count]` pairs, each copying `count` items of the previous array from `from`, or with `from` -1 taking the next `count` of `items`. */
export type ViewSplice<T> = { readonly runs: readonly number[]; readonly items: readonly T[] };

/** Text a streaming part streamed since the previous frame: the message at `at` of the spliced messages, its `state.markdown` grown by `append`, now at `version`. */
export type ViewAppend = { readonly at: number; readonly append: string; readonly version: number };
