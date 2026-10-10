import { Type } from "typebox";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import type {
  Activation,
  AddOutcome,
  Availability,
  ForgetOutcome,
  WorkspaceInfo,
  WorkspaceInspection,
  WorkspaceTarget,
} from "../workspaces.ts";
import { idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { nullable } from "./nullable.ts";

const UNAVAILABLE_REASON = Type.Enum(["unsupported", "unreachable"]);

/** The TypeBox schema of an `Availability`. */
export const AvailabilityType = Type.Union([
  Type.Object({ kind: Type.Literal("available") }),
  Type.Object({ kind: Type.Literal("unavailable"), reason: UNAVAILABLE_REASON }),
]);

/** The TypeBox schema of a `WorkspaceTarget`. */
export const WorkspaceTargetType = Type.Union([
  Type.Object({ kind: Type.Literal("local"), path: Type.String() }),
  Type.Object({ kind: Type.String(), locator: JsonType }),
]);

/** The TypeBox schema of an `Activation`. */
export const ActivationType = Type.Union([
  Type.Object({ kind: Type.Literal("active") }),
  Type.Object({ kind: Type.Literal("inactive") }),
  Type.Object({
    kind: Type.Literal("unavailable"),
    reason: UNAVAILABLE_REASON,
    workspace: idSchema<"workspace">(),
  }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
]);

/** The TypeBox schema of an `AddOutcome`. */
export const AddOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("added"), workspace: idSchema<"workspace">() }),
  Type.Object({ kind: Type.Literal("exists"), workspace: idSchema<"workspace">() }),
  Type.Object({ kind: Type.Literal("stale"), identity: idSchema<"environment-identity">() }),
  Type.Object({ kind: Type.Literal("unavailable"), reason: UNAVAILABLE_REASON }),
]);

/** The TypeBox schema of a `ForgetOutcome`. */
export const ForgetOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("forgotten") }),
  Type.Object({ kind: Type.Literal("busy"), sessions: Type.Array(idSchema<"session">()) }),
  Type.Object({ kind: Type.Literal("missing") }),
]);

/** The TypeBox schema of a `WorkspaceInspection`. */
export const WorkspaceInspectionType = Type.Object({
  target: WorkspaceTargetType,
  identity: idSchema<"environment-identity">(),
  availability: AvailabilityType,
  projectSources: Type.Array(Type.String()),
  registered: nullable(idSchema<"workspace">()),
});

/** The TypeBox schema of a `WorkspaceInfo`. */
export const WorkspaceInfoType = Type.Object({
  id: idSchema<"workspace">(),
  target: WorkspaceTargetType,
  identity: idSchema<"environment-identity">(),
  availability: AvailabilityType,
  projectResources: Type.Boolean(),
  projectSources: Type.Array(Type.String()),
  addedBy: idSchema<"principal">(),
  sessions: Type.Number(),
  writers: Type.Array(idSchema<"run">()),
});

/** Validates an `Availability`. */
export const AvailabilitySchema: Schema<Availability> = standard(AvailabilityType);

/** Validates a `WorkspaceTarget`. */
export const WorkspaceTargetSchema: Schema<WorkspaceTarget> = standard(
  withJson(WorkspaceTargetType),
);

/** Validates an `Activation`. */
export const ActivationSchema: Schema<Activation> = standard(ActivationType);

/** Validates an `AddOutcome`. */
export const AddOutcomeSchema: Schema<AddOutcome> = standard(AddOutcomeType);

/** Validates a `ForgetOutcome`. */
export const ForgetOutcomeSchema: Schema<ForgetOutcome> = standard(ForgetOutcomeType);

/** Validates a `WorkspaceInspection`. */
export const WorkspaceInspectionSchema: Schema<WorkspaceInspection> = standard(
  withJson(WorkspaceInspectionType),
);

/** Validates a `WorkspaceInfo`. */
export const WorkspaceInfoSchema: Schema<WorkspaceInfo> = standard(withJson(WorkspaceInfoType));
