import { Type } from "typebox";
import { ValidationIssueType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export const AuthorityType = Type.Enum(["participant", "owner", "maintenance"]);

export type Authority = Decoded<typeof AuthorityType>;

export const ExecutionCoverageType = Type.Union([
  Type.Object({ kind: Type.Literal("all") }),
  Type.Object({ kind: Type.Literal("workspace"), workspace: idSchema<"workspace">() }),
  Type.Object({ kind: Type.Literal("sessions"), sessions: Type.Array(idSchema<"session">()) }),
]);

export type ExecutionCoverage = Decoded<typeof ExecutionCoverageType>;

export const AdvanceReportType = Type.Union([
  Type.Object({ kind: Type.Literal("continue") }),
  Type.Object({ kind: Type.Literal("idle") }),
  Type.Object({ kind: Type.Literal("waiting"), until: nullable(Type.Number()) }),
  Type.Object({ kind: Type.Literal("retry"), until: Type.Number() }),
  Type.Object({ kind: Type.Literal("busy"), until: Type.Number() }),
  Type.Object({ kind: Type.Literal("fenced") }),
]);

export type AdvanceReport = Decoded<typeof AdvanceReportType>;

export const RepairPageType = Type.Object({
  runnable: Type.Array(Type.Object({ session: idSchema<"session">(), head: idSchema<"head">() })),
  next: nullable(idSchema<"cursor">()),
});

export type RepairPage = Decoded<typeof RepairPageType>;

export const PrincipalViewWireType = Type.Object({
  id: idSchema<"principal">(),
  label: Type.String(),
  authority: Type.Array(AuthorityType),
  pairedAt: Type.Number(),
});

export type PrincipalViewWire = Decoded<typeof PrincipalViewWireType>;

export const TailnetAccessType = Type.Enum(["owner", "tailnet"]);

export const TailnetSettingsType = Type.Object({
  enabled: Type.Boolean(),
  hostname: Type.String({ pattern: "^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$" }),
  tags: Type.Array(Type.String({ pattern: "^tag:[A-Za-z0-9][A-Za-z0-9-]*$" })),
  access: TailnetAccessType,
});

export type TailnetSettings = Decoded<typeof TailnetSettingsType>;

export const TailnetStatusType = Type.Object({
  state: Type.Enum([
    "disabled",
    "starting",
    "needs_login",
    "needs_machine_approval",
    "running",
    "stopped",
  ]),
  authUrl: Type.Optional(Type.String()),
  dnsName: Type.Optional(Type.String()),
  loginName: Type.Optional(Type.String()),
  https: Type.Enum(["pending", "available", "unavailable"]),
  access: TailnetAccessType,
  tags: Type.Array(Type.String()),
  reason: Type.Optional(
    Type.Enum([
      "locked",
      "protocol",
      "version",
      "hello_timeout",
      "start_timeout",
      "invalid_status",
      "exited",
    ]),
  ),
  holder: Type.Optional(Type.Number()),
  detail: Type.Optional(Type.String()),
  stderr: Type.Optional(Type.String()),
});

export type TailnetStatus = Decoded<typeof TailnetStatusType>;

export const ApprovalPolicyType = Type.Union([
  Type.Literal("ask"),
  Type.Literal("auto-edit"),
  Type.Literal("full"),
]);

/** What an MCP grant may do: call only `read` tools, or also `write` tools while the host's approval policy asks at least as much as `ceiling`. */
export const McpAccessType = Type.Union([
  Type.Object({ kind: Type.Literal("read-only") }),
  Type.Object({ kind: Type.Literal("ceiling"), ceiling: ApprovalPolicyType }),
]);

export type McpAccess = Decoded<typeof McpAccessType>;

export const McpCeilingType = Type.Object({ grant: Type.String(), ceiling: ApprovalPolicyType });

export type McpCeiling = Decoded<typeof McpCeilingType>;

export const McpGrantViewType = Type.Object({
  id: Type.String(),
  client: Type.String(),
  access: McpAccessType,
  createdAt: Type.Number(),
});

export type McpGrantView = Decoded<typeof McpGrantViewType>;

export const PluginLoadOutcomeType = Type.Object({
  kind: Type.Enum(["activated", "rejected", "kept-previous"]),
  id: Type.String(),
  issues: Type.Array(ValidationIssueType),
});

export type PluginLoadOutcome = Decoded<typeof PluginLoadOutcomeType>;

export const PluginCheckReportType = Type.Object({
  plugins: Type.Array(PluginLoadOutcomeType),
  collisions: Type.Array(ValidationIssueType),
});

export type PluginCheckReport = Decoded<typeof PluginCheckReportType>;

/** `input` and `output` are draft 2020-12 JSON Schemas of the wire form. */
export const OperationDescriptionType = Type.Object({
  name: Type.String(),
  summary: Type.String(),
  kind: Type.Enum(["query", "watch", "command", "receipt", "stream"]),
  authority: AuthorityType,
  scope: Type.Enum(["host", "session", "workspace"]),
  capability: Type.Optional(Type.Enum(["files", "git", "github", "browser"])),
  local: Type.Optional(Type.Literal(true)),
  input: JsonType,
  output: JsonType,
});

export type OperationDescription = Decoded<typeof OperationDescriptionType>;

export const PluginReplacementReportType = Type.Object({
  generation: idSchema<"catalog-generation">(),
  plugins: Type.Array(PluginLoadOutcomeType),
});

export type PluginReplacementReport = Decoded<typeof PluginReplacementReportType>;

export const DecodedObjectViewType = Type.Object({
  id: idSchema<"object">(),
  kind: Type.String(),
  parent: nullable(idSchema<"commit">()),
  body: JsonType,
  at: Type.Number(),
});

export type DecodedObjectView = Decoded<typeof DecodedObjectViewType>;

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

export type IntegrityReport = Decoded<typeof IntegrityReportType>;

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

export type PrincipalView = Omit<PrincipalViewWire, "authority"> & {
  readonly authority: ReadonlySet<Authority>;
};
