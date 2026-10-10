import { Type } from "typebox";
import type { TProperties } from "typebox";
import type { CommitBody, DurableEvent, PatchEvent, SessionEvent } from "../events.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { ConfigurationType } from "./configuration.ts";
import { FailureType } from "./errors.ts";
import { FileChangeType } from "./files.ts";
import { SeqType, idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { DeliveryType, MessageSourceType, ScheduleType, UserContentType } from "./messages.ts";
import { ContextViewType, UsageType } from "./models.ts";
import { nullable } from "./nullable.ts";
import { PlacementType } from "./parts.ts";
import { BackgroundItemType, RunEndType, RunViewType, WaitTargetType } from "./runs.ts";
import { SessionCatalogViewType, SessionInfoType } from "./sessions.ts";
import { ToolClassType, ToolOutcomeType, ToolProgressType } from "./tools.ts";
import { ActivationType } from "./workspaces.ts";

const CHANGES = nullable(
  Type.Object({ added: Type.Number(), removed: Type.Number(), paths: Type.Array(Type.String()) }),
);

const REPLACED = nullable(
  Type.Object({ previous: idSchema<"message">(), stopped: nullable(idSchema<"run">()) }),
);

/** The TypeBox schema of a `CommitBody`. */
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
      configuration: ConfigurationType,
      replaced: REPLACED,
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
    }),
    Type.Object({
      ...common,
      ...PART,
      change: Type.Literal("updated"),
      state: JsonType,
      version: Type.Number(),
    }),
    Type.Object({
      ...common,
      ...PART,
      change: Type.Literal("settled"),
      commit: idSchema<"commit">(),
      endedAt: Type.Number(),
    }),
    Type.Object({ ...common, ...PART, change: Type.Literal("failed"), failure: FailureType }),
    Type.Object({ ...common, ...PART, change: Type.Literal("closed") }),
    Type.Object({
      ...common,
      ...CALL,
      change: Type.Literal("intent"),
      name: Type.String(),
      args: JsonType,
      class: ToolClassType,
    }),
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
      usage: UsageType,
      context: ContextViewType,
      step: Type.Enum(["assistant", "compaction", "summary", "plugin"]),
    }),
    Type.Object({ ...common, kind: Type.Literal("changes"), files: Type.Array(FileChangeType) }),
    Type.Object({ ...common, kind: Type.Literal("session"), info: SessionInfoType }),
    Type.Object({ ...common, kind: Type.Literal("activation"), activation: ActivationType }),
    Type.Object({ ...common, kind: Type.Literal("catalog"), catalog: SessionCatalogViewType }),
  ]);
}

/** The TypeBox schema of a `DurableEvent`. */
export const DurableEventType = durableEvent({ head: nullable(idSchema<"head">()) });

/** The TypeBox schema of a `SessionEvent`. */
export const SessionEventType = durableEvent({
  seq: SeqType,
  at: Type.Number(),
  head: nullable(idSchema<"head">()),
});

/** The TypeBox schema of a `PatchEvent`. */
export const PatchEventType = Type.Union([
  Type.Object({ ...PATCH, append: Type.String() }),
  Type.Object({ ...PATCH, progress: ToolProgressType }),
]);

/** Validates a `CommitBody`. */
export const CommitBodySchema: Schema<CommitBody> = standard(CommitBodyType);

/** Validates a `DurableEvent`. */
export const DurableEventSchema: Schema<DurableEvent> = standard(withJson(DurableEventType));

/** Validates a `SessionEvent`. */
export const SessionEventSchema: Schema<SessionEvent> = standard(withJson(SessionEventType));

/** Validates a `PatchEvent`. */
export const PatchEventSchema: Schema<PatchEvent> = standard(withJson(PatchEventType));
