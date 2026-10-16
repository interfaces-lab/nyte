import { Type } from "typebox";
import type { TSchema } from "typebox";
import type { PartStatus, PartView, Placement, ToolPartState } from "../parts.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { FailureType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { nullable } from "./nullable.ts";
import { WaitTargetType } from "./runs.ts";
import { ToolClassType, ToolOutcomeType, ToolProgressType } from "./tools.ts";

export const SignatureType = nullable(JsonType);

export const PlacementType = Type.Union([
  Type.Object({ kind: Type.Literal("transcript"), role: Type.Enum(["step", "answer", "note"]) }),
  Type.Object({ kind: Type.Literal("modal") }),
  Type.Object({ kind: Type.String() }, { additionalProperties: JsonType }),
]);

export const PartStatusType = Type.Union([
  Type.Object({
    kind: Type.Literal("live"),
    run: nullable(idSchema<"run">()),
    waiting: Type.Optional(idSchema<"call">()),
    answer: Type.Optional(Type.Object({ action: Type.String(), input: JsonType })),
  }),
  Type.Object({ kind: Type.Literal("waiting"), run: idSchema<"run">(), on: WaitTargetType }),
  Type.Object({
    kind: Type.Literal("settled"),
    commit: idSchema<"commit">(),
    endedAt: Type.Number(),
  }),
  Type.Object({
    kind: Type.Literal("failed"),
    run: nullable(idSchema<"run">()),
    failure: FailureType,
  }),
]);

export const PartViewType = Type.Object({
  id: idSchema<"part">(),
  partKind: Type.String(),
  placement: PlacementType,
  state: JsonType,
  version: Type.Number(),
  status: PartStatusType,
  owner: nullable(Type.String()),
});

const TOOL_CALL = {
  call: idSchema<"call">(),
  name: Type.String(),
  args: JsonType,
  class: ToolClassType,
};

export const ToolPartStateType = Type.Union([
  Type.Object({ ...TOOL_CALL, phase: Type.Literal("calling") }),
  Type.Object({
    ...TOOL_CALL,
    phase: Type.Literal("running"),
    progress: nullable(ToolProgressType),
  }),
  Type.Object({
    ...TOOL_CALL,
    phase: Type.Literal("settled"),
    outcome: ToolOutcomeType,
    changes: nullable(
      Type.Object({
        added: Type.Number(),
        removed: Type.Number(),
        paths: Type.Array(Type.String()),
      }),
    ),
  }),
]);

export function actOutcomeSchema<T extends TSchema>(output: T) {
  return standard(
    withJson(
      Type.Union([
        Type.Object({ kind: Type.Literal("ok"), output }),
        Type.Object({ kind: Type.Literal("rejected"), reason: Type.String() }),
        Type.Object({ kind: Type.Literal("unknown-action") }),
        Type.Object({ kind: Type.Literal("closed") }),
        Type.Object({ kind: Type.Literal("no-owner") }),
        Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
      ]),
    ),
  );
}

export const PlacementSchema: Schema<Placement> = standard(withJson(PlacementType));

export const PartStatusSchema: Schema<PartStatus> = standard(withJson(PartStatusType));

export const PartViewSchema: Schema<PartView> = standard(withJson(PartViewType));

export const ToolPartStateSchema: Schema<ToolPartState> = standard(withJson(ToolPartStateType));
