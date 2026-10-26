import { Type } from "typebox";
import type { TProperties } from "typebox";
import { ConfigurationType } from "./configuration.ts";
import { FailureType } from "./errors.ts";
import { FileChangeType } from "./files.ts";
import { idSchema, SeqType } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { DeliveryType, MessageSourceType, ScheduleType, UserContentType } from "./messages.ts";
import { ContextViewType, ModelRefType, UsageType } from "./models.ts";
import { PlacementType, ToolChangesType } from "./parts.ts";
import { BackgroundItemType, RunEndType, RunViewType, WaitTargetType } from "./runs.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { SessionCatalogViewType, SessionInfoType } from "./sessions.ts";
import { ToolOutcomeType, ToolProgressType } from "./tools.ts";
import { nullable } from "./wire/nullable.ts";
import { ActivationType } from "./workspaces.ts";

const CHANGES = nullable(ToolChangesType);

const REPLACED = nullable(
  Type.Object({ previous: idSchema<"message">(), stopped: nullable(idSchema<"run">()) }),
);

export const CommitBodyType = Type.Union([
  Type.Object({
    kind: Type.Literal("user"),
    message: idSchema<"message">(),
    content: UserContentType,
    source: MessageSourceType,
    delivery: DeliveryType,
    siblings: Type.Array(idSchema<"commit">()),
  }),
  Type.Object({ kind: Type.Literal("part"), part: idSchema<"part">() }),
  Type.Object({
    kind: Type.Literal("compaction"),
    part: idSchema<"part">(),
    replaces: Type.Array(idSchema<"commit">()),
  }),
  Type.Object({
    kind: Type.Literal("branchSummary"),
    part: idSchema<"part">(),
    replaces: Type.Array(idSchema<"commit">()),
  }),
]);

export type CommitBody = Decoded<typeof CommitBodyType>;

const INPUT = { kind: Type.Literal("input"), message: idSchema<"message">() };

const RUN = { kind: Type.Literal("run"), run: idSchema<"run">() };

const PART = { kind: Type.Literal("part"), part: idSchema<"part">() };

const CALL = { kind: Type.Literal("call"), call: idSchema<"call">(), part: idSchema<"part">() };

const PATCH = { kind: Type.Literal("patch"), part: idSchema<"part">() };

function durableEvent<Common extends TProperties>(common: Common) {
  return Type.Union([
    Type.Object({
      ...common,
      kind: Type.Literal("commit"),
      id: idSchema<"commit">(),
      parent: nullable(idSchema<"commit">()),
      run: nullable(idSchema<"run">()),
      body: CommitBodyType,
    }),
    Type.Object({
      ...common,
      kind: Type.Literal("head"),
      from: nullable(idSchema<"commit">()),
      to: nullable(idSchema<"commit">()),
      reason: Type.Enum(["moved", "merged", "created", "removed"]),
    }),
    Type.Object({
      ...common,
      kind: Type.Literal("seen"),
      principal: idSchema<"principal">(),
      commit: nullable(idSchema<"commit">()),
    }),
    Type.Object({
      ...common,
      ...INPUT,
      change: Type.Literal("admitted"),
      content: UserContentType,
      source: MessageSourceType,
      delivery: DeliveryType,
      schedule: ScheduleType,
      covered: Type.Boolean(),
      replaced: REPLACED,
      requires: Type.Optional(Type.Array(Type.String())),
    }),
    Type.Object({
      ...common,
      ...INPUT,
      change: Type.Literal("scheduled"),
      schedule: ScheduleType,
      position: Type.Number(),
    }),
    Type.Object({
      ...common,
      ...INPUT,
      change: Type.Literal("landed"),
      commit: idSchema<"commit">(),
      run: nullable(idSchema<"run">()),
    }),
    Type.Object({ ...common, ...INPUT, change: Type.Literal("withdrawn") }),
    Type.Object({
      ...common,
      ...INPUT,
      change: Type.Literal("superseded"),
      by: idSchema<"message">(),
    }),
    Type.Object({ ...common, ...RUN, change: Type.Literal("started"), view: RunViewType }),
    Type.Object({
      ...common,
      ...RUN,
      change: Type.Literal("phase"),
      phase: Type.Enum(["responding", "executing"]),
    }),
    Type.Object({ ...common, ...RUN, change: Type.Literal("waiting"), on: WaitTargetType }),
    Type.Object({
      ...common,
      ...RUN,
      change: Type.Literal("retrying"),
      attempt: Type.Number(),
      until: Type.Number(),
      reason: Type.String(),
    }),
    Type.Object({ ...common, ...RUN, change: Type.Literal("stopping") }),
    Type.Object({ ...common, ...RUN, change: Type.Literal("ended"), end: RunEndType }),
    Type.Object({
      ...common,
      ...PART,
      change: Type.Literal("created"),
      partKind: Type.String(),
      placement: PlacementType,
      state: JsonType,
      version: Type.Number(),
      run: nullable(idSchema<"run">()),
      owner: nullable(Type.String()),
      model: Type.Optional(ModelRefType),
    }),
    Type.Object({
      ...common,
      ...PART,
      change: Type.Literal("updated"),
      state: JsonType,
      version: Type.Number(),
    }),
    Type.Object({ ...common, ...PART, change: Type.Literal("waiting"), call: idSchema<"call">() }),
    Type.Object({
      ...common,
      ...PART,
      change: Type.Literal("settled"),
      commit: idSchema<"commit">(),
      endedAt: Type.Number(),
    }),
    Type.Object({ ...common, ...PART, change: Type.Literal("failed"), failure: FailureType }),
    Type.Object({
      ...common,
      ...PART,
      change: Type.Literal("answered"),
      answer: Type.Object({ action: Type.String(), input: JsonType }),
    }),
    Type.Object({ ...common, ...PART, change: Type.Literal("closed") }),
    Type.Object({ ...common, ...CALL, change: Type.Literal("intent") }),
    Type.Object({ ...common, ...CALL, change: Type.Literal("waiting"), on: WaitTargetType }),
    Type.Object({
      ...common,
      ...CALL,
      change: Type.Literal("settled"),
      outcome: ToolOutcomeType,
      changes: CHANGES,
    }),
    Type.Object({ ...common, kind: Type.Literal("background"), item: BackgroundItemType }),
    Type.Object({
      ...common,
      kind: Type.Literal("configured"),
      selected: nullable(ConfigurationType),
      effective: nullable(ConfigurationType),
    }),
    Type.Object({
      ...common,
      kind: Type.Literal("request"),
      model: nullable(ModelRefType),
      usage: UsageType,
      context: ContextViewType,
      step: Type.Enum(["assistant", "compaction", "summary", "plugin"]),
    }),
    Type.Object({
      ...common,
      kind: Type.Literal("changes"),
      change: Type.Literal("merged"),
      files: Type.Array(FileChangeType),
      cleared: Type.Array(Type.String()),
    }),
    Type.Object({ ...common, kind: Type.Literal("changes"), files: Type.Array(FileChangeType) }),
    Type.Object({ ...common, kind: Type.Literal("session"), info: SessionInfoType }),
    Type.Object({ ...common, kind: Type.Literal("activation"), activation: ActivationType }),
    Type.Object({ ...common, kind: Type.Literal("catalog"), catalog: SessionCatalogViewType }),
  ]);
}

export const DurableEventType = durableEvent({ head: nullable(idSchema<"head">()) });

export type DurableEvent = Decoded<typeof DurableEventType>;

export const SessionEventType = durableEvent({
  seq: SeqType,
  at: Type.Number(),
  head: nullable(idSchema<"head">()),
});

export type SessionEvent = Decoded<typeof SessionEventType>;

export const PatchEventType = Type.Union([
  Type.Object({ ...PATCH, append: Type.String() }),
  Type.Object({ ...PATCH, markdown: Type.String() }),
  Type.Object({ ...PATCH, progress: ToolProgressType }),
]);

export type PatchEvent = Decoded<typeof PatchEventType>;

export const CommitBodySchema: Schema<CommitBody> = standard(CommitBodyType);

export const DurableEventSchema: Schema<DurableEvent> = standard(withJson(DurableEventType));

export const SessionEventSchema: Schema<SessionEvent> = standard(withJson(SessionEventType));

export const PatchEventSchema: Schema<PatchEvent> = standard(withJson(PatchEventType));
