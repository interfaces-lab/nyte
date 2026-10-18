import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { JsonObjectType, JsonType, withJson } from "./json.ts";
import { PositionType, UserContentType } from "./messages.ts";
import { ModelRefType } from "./models.ts";
import { ExecutionType } from "./runs.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";
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

export type HeadInfo = Decoded<typeof HeadInfoType>;

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

export type SessionInfo = Decoded<typeof SessionInfoType>;

/**
 * The slash names Nyte's own clients keep for their built-in commands and
 * aliases. The host refuses a plugin command that takes one, so a client never
 * hides it behind its own.
 */
export const CLIENT_COMMAND_NAMES = [
  "accounts",
  "cd",
  "compact",
  "continue",
  "edit",
  "help",
  "login",
  "logout",
  "mcp",
  "new",
  "plugins",
  "pr",
  "quit",
  "reload",
  "resume",
  "sessions",
  "settings",
  "skills",
  "tasks",
  "tree",
  "trust",
  "update",
  "usage",
] as const;

export type ClientCommandName = (typeof CLIENT_COMMAND_NAMES)[number];

/** A name a user can type after `/` in every client: lowercase ASCII letters, digits and `-`, not starting with `-`. */
export const COMMAND_NAME = /^[a-z0-9][a-z0-9-]*$/u;

export const CommandInfoType = Type.Object({
  name: Type.String(),
  owner: Type.String(),
  side: Type.Enum(["core", "client"]),
  title: Type.String(),
  description: Type.String(),
  /** Picking the command waits for text after its name instead of running it at once. */
  takesText: Type.Boolean(),
  /** The command suggests that text: ask `completeCommand` as it is typed. */
  completes: Type.Boolean(),
  category: Type.Optional(Type.String()),
  keywords: Type.Optional(Type.Array(Type.String())),
});

export type CommandInfo = Decoded<typeof CommandInfoType>;

/** One suggestion for the text after a command's name: picking it replaces that text with `value`. */
export const CommandCompletionType = Type.Object({
  value: Type.String(),
  label: Type.String(),
  description: Type.Optional(Type.String()),
});

export type CommandCompletion = Decoded<typeof CommandCompletionType>;

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

export type SettingInfo = Decoded<typeof SettingInfoType>;

export const SkillInfoType = Type.Object({
  name: Type.String(),
  owner: Type.String(),
  description: Type.String(),
  location: Type.String(),
});

export type SkillInfo = Decoded<typeof SkillInfoType>;

export const AgentInfoType = Type.Object({
  id: Type.String(),
  owner: Type.String(),
  description: nullable(Type.String()),
  model: nullable(ModelRefType),
  mode: Type.Enum(["primary", "subagent", "all"]),
});

export type AgentInfo = Decoded<typeof AgentInfoType>;

export const ToolInfoType = Type.Object({
  name: Type.String(),
  owner: Type.String(),
  namespace: nullable(Type.String()),
  description: Type.String(),
  parameters: JsonObjectType,
  output: nullable(JsonObjectType),
  exposure: Type.Enum(["model", "deferred", "code", "hidden"]),
});

export type ToolInfo = Decoded<typeof ToolInfoType>;

export const SessionCatalogViewType = Type.Object({
  commands: Type.Array(CommandInfoType),
  settings: Type.Array(SettingInfoType),
  skills: Type.Array(SkillInfoType),
  agents: Type.Array(AgentInfoType),
  tools: Type.Array(ToolInfoType),
});

export type SessionCatalogView = Decoded<typeof SessionCatalogViewType>;

/** What a new chat in a workspace would offer before it exists: its plugin commands and skills. */
export const WorkspaceCatalogViewType = Type.Object({
  commands: Type.Array(CommandInfoType),
  skills: Type.Array(SkillInfoType),
});

export type WorkspaceCatalogView = Decoded<typeof WorkspaceCatalogViewType>;

export const CommandOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("ran"), output: nullable(Type.String()) }),
  Type.Object({ kind: Type.Literal("sent"), receipt: idSchema<"receipt">() }),
  Type.Object({ kind: Type.Literal("unknown") }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
]);

export type CommandOutcome = Decoded<typeof CommandOutcomeType>;

/** What a command run outside any chat did: `prompt` is the first message of the chat it asks to start. */
export const WorkspaceCommandOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("ran"), output: nullable(Type.String()) }),
  Type.Object({ kind: Type.Literal("prompt"), content: UserContentType }),
  Type.Object({ kind: Type.Literal("unknown") }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
]);

export type WorkspaceCommandOutcome = Decoded<typeof WorkspaceCommandOutcomeType>;

export const UpdateOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("updated") }),
  Type.Object({ kind: Type.Literal("busy"), runs: Type.Array(idSchema<"run">()) }),
  Type.Object({ kind: Type.Literal("unknown-workspace") }),
]);

export type UpdateOutcome = Decoded<typeof UpdateOutcomeType>;

export const RemoveSessionOutcomeType = Type.Union([
  Type.Object({ kind: Type.Literal("removed") }),
  Type.Object({ kind: Type.Literal("busy"), runs: Type.Array(idSchema<"run">()) }),
  Type.Object({ kind: Type.Literal("has-children"), children: Type.Array(idSchema<"session">()) }),
]);

export type RemoveSessionOutcome = Decoded<typeof RemoveSessionOutcomeType>;

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

export const CommandCompletionsSchema: Schema<readonly CommandCompletion[]> = standard(
  Type.Array(CommandCompletionType),
);

export const WorkspaceCommandOutcomeSchema: Schema<WorkspaceCommandOutcome> = standard(
  WorkspaceCommandOutcomeType,
);

export const UpdateOutcomeSchema: Schema<UpdateOutcome> = standard(UpdateOutcomeType);

export const RemoveSessionOutcomeSchema: Schema<RemoveSessionOutcome> =
  standard(RemoveSessionOutcomeType);
