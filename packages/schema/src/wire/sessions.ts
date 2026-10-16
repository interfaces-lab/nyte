import { Type } from "typebox";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import type {
  AgentInfo,
  CommandInfo,
  CommandOutcome,
  HeadInfo,
  RemoveSessionOutcome,
  SessionCatalogView,
  SessionInfo,
  SettingInfo,
  SkillInfo,
  ToolInfo,
  UpdateOutcome,
} from "../sessions.ts";
import { ValidationIssueType } from "./errors.ts";
import { idSchema } from "./ids.ts";
import { JsonObjectType, JsonType, withJson } from "./json.ts";
import { PositionType } from "./messages.ts";
import { ModelRefType } from "./models.ts";
import { nullable } from "./nullable.ts";
import { ExecutionType } from "./runs.ts";
import { ActivationType } from "./workspaces.ts";

export const HeadInfoType = Type.Object({
  name: idSchema<"head">(),
  tip: PositionType,
  stack: nullable(
    Type.Object({ parent: idSchema<"head">(), base: PositionType, stale: Type.Boolean() }),
  ),
  execution: ExecutionType,
  unread: Type.Boolean(),
});

export const SessionInfoType = Type.Object({
  id: idSchema<"session">(),
  name: nullable(Type.String()),
  parent: nullable(idSchema<"session">()),
  call: nullable(idSchema<"call">()),
  workspace: idSchema<"workspace">(),
  pinned: Type.Boolean(),
  archived: Type.Boolean(),
  activation: ActivationType,
  heads: Type.Array(HeadInfoType),
  createdAt: Type.Number(),
  lastActivityAt: Type.Number(),
});

export const CommandInfoType = Type.Object({
  name: Type.String(),
  owner: Type.String(),
  side: Type.Enum(["core", "client"]),
  title: Type.String(),
  description: Type.String(),
  arguments: nullable(JsonObjectType),
  category: Type.Optional(Type.String()),
  keywords: Type.Optional(Type.Array(Type.String())),
});

export const SettingInfoType = Type.Object({
  id: Type.String(),
  owner: Type.String(),
  scope: Type.Enum(["host", "session"]),
  label: Type.String(),
  schema: JsonObjectType,
  choices: nullable(
    Type.Array(
      Type.Object({ value: JsonType, label: Type.String(), badge: Type.Optional(Type.String()) }),
    ),
  ),
  value: JsonType,
  from: Type.Enum(["default", "host", "session"]),
});

export const SkillInfoType = Type.Object({
  name: Type.String(),
  owner: Type.String(),
  description: Type.String(),
  location: Type.String(),
});

export const AgentInfoType = Type.Object({
  id: Type.String(),
  owner: Type.String(),
  description: nullable(Type.String()),
  model: nullable(ModelRefType),
  mode: Type.Enum(["primary", "subagent", "all"]),
});

export const ToolInfoType = Type.Object({
  name: Type.String(),
  owner: Type.String(),
  namespace: nullable(Type.String()),
  description: Type.String(),
  parameters: JsonObjectType,
  output: nullable(JsonObjectType),
  exposure: Type.Enum(["model", "deferred", "code", "hidden"]),
});

export const SessionCatalogViewType = Type.Object({
  commands: Type.Array(CommandInfoType),
  settings: Type.Array(SettingInfoType),
  skills: Type.Array(SkillInfoType),
  agents: Type.Array(AgentInfoType),
  tools: Type.Array(ToolInfoType),
});

export const CommandOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("ran"), output: nullable(Type.String()) }),
  Type.Object({ kind: Type.Literal("sent"), receipt: idSchema<"receipt">() }),
  Type.Object({ kind: Type.Literal("invalid"), issues: Type.Array(ValidationIssueType) }),
  Type.Object({ kind: Type.Literal("unknown") }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
]);

export const UpdateOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("updated") }),
  Type.Object({ kind: Type.Literal("busy"), runs: Type.Array(idSchema<"run">()) }),
  Type.Object({ kind: Type.Literal("unknown-workspace") }),
]);

export const RemoveSessionOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("removed") }),
  Type.Object({ kind: Type.Literal("busy"), runs: Type.Array(idSchema<"run">()) }),
  Type.Object({ kind: Type.Literal("has-children"), children: Type.Array(idSchema<"session">()) }),
]);

export const HeadInfoSchema: Schema<HeadInfo> = standard(withJson(HeadInfoType));

export const SessionInfoSchema: Schema<SessionInfo> = standard(withJson(SessionInfoType));

export const CommandInfoSchema: Schema<CommandInfo> = standard(withJson(CommandInfoType));

export const SettingInfoSchema: Schema<SettingInfo> = standard(withJson(SettingInfoType));

export const SkillInfoSchema: Schema<SkillInfo> = standard(SkillInfoType);

export const AgentInfoSchema: Schema<AgentInfo> = standard(AgentInfoType);

export const ToolInfoSchema: Schema<ToolInfo> = standard(withJson(ToolInfoType));

export const SessionCatalogViewSchema: Schema<SessionCatalogView> = standard(
  withJson(SessionCatalogViewType),
);

export const CommandOutcomeSchema: Schema<CommandOutcome> = standard(CommandOutcomeType);

export const UpdateOutcomeSchema: Schema<UpdateOutcome> = standard(UpdateOutcomeType);

export const RemoveSessionOutcomeSchema: Schema<RemoveSessionOutcome> =
  standard(RemoveSessionOutcomeType);
