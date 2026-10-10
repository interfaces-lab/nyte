import { Type } from "typebox";
import type { Authority } from "../declaration.ts";
import type {
  AdvanceReport,
  DecodedObjectView,
  ExecutionCoverage,
  IntegrityReport,
  PluginCheckReport,
  PluginLoadOutcome,
  PluginReplacementReport,
  PrincipalView,
  PruneReport,
  RepairPage,
} from "../host.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { ValidationIssueType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { nullable } from "./nullable.ts";

/** Returns the wire form of a `PrincipalView`: its authority as an array. */
export type PrincipalViewWire = Omit<PrincipalView, "authority"> & {
  readonly authority: readonly Authority[];
};

/** The TypeBox schema of an `Authority`. */
export const AuthorityType = Type.Enum(["participant", "owner", "maintenance"]);

/** The TypeBox schema of an `ExecutionCoverage`. */
export const ExecutionCoverageType = Type.Union([
  Type.Object({ kind: Type.Literal("all") }),
  Type.Object({ kind: Type.Literal("workspace"), workspace: idSchema<"workspace">() }),
  Type.Object({ kind: Type.Literal("sessions"), sessions: Type.Array(idSchema<"session">()) }),
]);

/** The TypeBox schema of an `AdvanceReport`. */
export const AdvanceReportType = Type.Union([
  Type.Object({ kind: Type.Literal("continue") }),
  Type.Object({ kind: Type.Literal("idle") }),
  Type.Object({ kind: Type.Literal("waiting"), until: nullable(Type.Number()) }),
  Type.Object({ kind: Type.Literal("retry"), until: Type.Number() }),
  Type.Object({ kind: Type.Literal("busy"), until: Type.Number() }),
  Type.Object({ kind: Type.Literal("fenced") }),
]);

/** The TypeBox schema of a `RepairPage`. */
export const RepairPageType = Type.Object({
  runnable: Type.Array(Type.Object({ session: idSchema<"session">(), head: idSchema<"head">() })),
  next: nullable(idSchema<"cursor">()),
});

/** The TypeBox schema of a `PruneReport`. */
export const PruneReportType = Type.Object({
  objects: Type.Number(),
  bytes: Type.Number(),
  retained: Type.Number(),
});

/** The TypeBox schema of a `PrincipalViewWire`. */
export const PrincipalViewWireType = Type.Object({
  id: idSchema<"principal">(),
  label: Type.String(),
  authority: Type.Array(AuthorityType),
  pairedAt: Type.Number(),
  lastSeenAt: nullable(Type.Number()),
});

/** The TypeBox schema of a `PluginLoadOutcome`. */
export const PluginLoadOutcomeType = Type.Object({
  kind: Type.Enum(["activated", "rejected", "kept-previous"]),
  id: Type.String(),
  issues: Type.Array(ValidationIssueType),
});

/** The TypeBox schema of a `PluginCheckReport`. */
export const PluginCheckReportType = Type.Object({
  plugins: Type.Array(PluginLoadOutcomeType),
  collisions: Type.Array(ValidationIssueType),
});

/** The TypeBox schema of a `PluginReplacementReport`. */
export const PluginReplacementReportType = Type.Object({
  generation: idSchema<"catalog-generation">(),
  plugins: Type.Array(PluginLoadOutcomeType),
});

/** The TypeBox schema of a `DecodedObjectView`. */
export const DecodedObjectViewType = Type.Object({
  id: idSchema<"object">(),
  kind: Type.String(),
  parent: nullable(idSchema<"commit">()),
  body: JsonType,
  at: Type.Number(),
});

/** The TypeBox schema of an `IntegrityReport`. */
export const IntegrityReportType = Type.Object({
  ok: Type.Boolean(),
  issues: Type.Array(
    Type.Object({
      ref: nullable(Type.String()),
      object: nullable(idSchema<"commit">()),
      message: Type.String(),
    }),
  ),
});

/** Validates an `Authority`. */
export const AuthoritySchema: Schema<Authority> = standard(AuthorityType);

/** Validates an `ExecutionCoverage`. */
export const ExecutionCoverageSchema: Schema<ExecutionCoverage> = standard(ExecutionCoverageType);

/** Validates an `AdvanceReport`. */
export const AdvanceReportSchema: Schema<AdvanceReport> = standard(AdvanceReportType);

/** Validates a `RepairPage`. */
export const RepairPageSchema: Schema<RepairPage> = standard(RepairPageType);

/** Validates a `PruneReport`. */
export const PruneReportSchema: Schema<PruneReport> = standard(PruneReportType);

/** Validates a `PrincipalViewWire`. */
export const PrincipalViewWireSchema: Schema<PrincipalViewWire> = standard(PrincipalViewWireType);

/** Validates a `PluginLoadOutcome`. */
export const PluginLoadOutcomeSchema: Schema<PluginLoadOutcome> = standard(PluginLoadOutcomeType);

/** Validates a `PluginCheckReport`. */
export const PluginCheckReportSchema: Schema<PluginCheckReport> = standard(PluginCheckReportType);

/** Validates a `PluginReplacementReport`. */
export const PluginReplacementReportSchema: Schema<PluginReplacementReport> = standard(
  PluginReplacementReportType,
);

/** Validates a `DecodedObjectView`. */
export const DecodedObjectViewSchema: Schema<DecodedObjectView> = standard(
  withJson(DecodedObjectViewType),
);

/** Validates an `IntegrityReport`. */
export const IntegrityReportSchema: Schema<IntegrityReport> = standard(IntegrityReportType);
