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
  RepairPage,
} from "../host.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { ValidationIssueType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { nullable } from "./nullable.ts";

export type PrincipalViewWire = Omit<PrincipalView, "authority"> & {
  readonly authority: readonly Authority[];
};

export const AuthorityType = Type.Enum(["participant", "owner", "maintenance"]);

export const ExecutionCoverageType = Type.Union([
  Type.Object({ kind: Type.Literal("all") }),
  Type.Object({ kind: Type.Literal("workspace"), workspace: idSchema<"workspace">() }),
  Type.Object({ kind: Type.Literal("sessions"), sessions: Type.Array(idSchema<"session">()) }),
]);

export const AdvanceReportType = Type.Union([
  Type.Object({ kind: Type.Literal("continue") }),
  Type.Object({ kind: Type.Literal("idle") }),
  Type.Object({ kind: Type.Literal("waiting"), until: nullable(Type.Number()) }),
  Type.Object({ kind: Type.Literal("retry"), until: Type.Number() }),
  Type.Object({ kind: Type.Literal("busy"), until: Type.Number() }),
  Type.Object({ kind: Type.Literal("fenced") }),
]);

export const RepairPageType = Type.Object({
  runnable: Type.Array(Type.Object({ session: idSchema<"session">(), head: idSchema<"head">() })),
  next: nullable(idSchema<"cursor">()),
});

export const PrincipalViewWireType = Type.Object({
  id: idSchema<"principal">(),
  label: Type.String(),
  authority: Type.Array(AuthorityType),
  pairedAt: Type.Number(),
});

export const PluginLoadOutcomeType = Type.Object({
  kind: Type.Enum(["activated", "rejected", "kept-previous"]),
  id: Type.String(),
  issues: Type.Array(ValidationIssueType),
});

export const PluginCheckReportType = Type.Object({
  plugins: Type.Array(PluginLoadOutcomeType),
  collisions: Type.Array(ValidationIssueType),
});

export const PluginReplacementReportType = Type.Object({
  generation: idSchema<"catalog-generation">(),
  plugins: Type.Array(PluginLoadOutcomeType),
});

export const DecodedObjectViewType = Type.Object({
  id: idSchema<"object">(),
  kind: Type.String(),
  parent: nullable(idSchema<"commit">()),
  body: JsonType,
  at: Type.Number(),
});

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

export const AuthoritySchema: Schema<Authority> = standard(AuthorityType);

export const ExecutionCoverageSchema: Schema<ExecutionCoverage> = standard(ExecutionCoverageType);

export const AdvanceReportSchema: Schema<AdvanceReport> = standard(AdvanceReportType);

export const RepairPageSchema: Schema<RepairPage> = standard(RepairPageType);

export const PrincipalViewWireSchema: Schema<PrincipalViewWire> = standard(PrincipalViewWireType);

export const PluginLoadOutcomeSchema: Schema<PluginLoadOutcome> = standard(PluginLoadOutcomeType);

export const PluginCheckReportSchema: Schema<PluginCheckReport> = standard(PluginCheckReportType);

export const PluginReplacementReportSchema: Schema<PluginReplacementReport> = standard(
  PluginReplacementReportType,
);

export const DecodedObjectViewSchema: Schema<DecodedObjectView> = standard(
  withJson(DecodedObjectViewType),
);

export const IntegrityReportSchema: Schema<IntegrityReport> = standard(IntegrityReportType);
