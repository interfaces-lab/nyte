import { Type } from "typebox";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import type { Message, SessionView, TurnInfo, UserStatus, ViewOptions } from "../views.ts";
import { ConfigurationType } from "./configuration.ts";
import { FileChangeType } from "./files.ts";
import { SeqType, idSchema } from "./ids.ts";
import { withJson } from "./json.ts";
import { DeliveryType, MessageSourceType, ScheduleType, UserContentType } from "./messages.ts";
import { ContextViewType } from "./models.ts";
import { nullable } from "./nullable.ts";
import { PartStatusType, PartViewType } from "./parts.ts";
import { BackgroundItemType, ExecutionType, RunEndType, WaitTargetType } from "./runs.ts";
import { HeadInfoType, SessionCatalogViewType } from "./sessions.ts";
import { ActivationType } from "./workspaces.ts";

const CLASS_SUMMARY = Type.Object({ count: Type.Number(), paths: Type.Array(Type.String()) });

const MESSAGE = { id: idSchema<"message">(), turn: idSchema<"turn">(), at: Type.Number() };

/** The TypeBox schema of `ViewOptions`. */
export const ViewOptionsType = Type.Object({ tail: Type.Optional(Type.Number()) });

/** The TypeBox schema of a `UserStatus`. */
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

/** The TypeBox schema of a view `Message`. */
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

/** The TypeBox schema of a `TurnInfo`. */
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

/** The TypeBox schema of a `SessionView`. */
export const SessionViewType = Type.Object({
  revision: idSchema<"revision">(),
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

/** Validates `ViewOptions`. */
export const ViewOptionsSchema: Schema<ViewOptions> = standard(ViewOptionsType);

/** Validates a `UserStatus`. */
export const UserStatusSchema: Schema<UserStatus> = standard(UserStatusType);

/** Validates a view `Message`. */
export const MessageSchema: Schema<Message> = standard(MessageType);

/** Validates a `TurnInfo`. */
export const TurnInfoSchema: Schema<TurnInfo> = standard(TurnInfoType);

/** Validates a `SessionView`. */
export const SessionViewSchema: Schema<SessionView> = standard(withJson(SessionViewType));
