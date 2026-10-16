import { Type } from "typebox";
import type { McpChange, McpServerConfig, McpView } from "../mcp.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { ValidationIssueType } from "./errors.ts";
import { nullable } from "./nullable.ts";

const ExposureType = Type.Enum(["model", "deferred", "code", "hidden"]);

const McpServerStateType = Type.Union([
  Type.Object({ kind: Type.Literal("disabled") }),
  Type.Object({ kind: Type.Literal("connecting") }),
  Type.Object({
    kind: Type.Literal("connected"),
    tools: Type.Array(
      Type.Object({ name: Type.String(), description: Type.String(), exposure: ExposureType }),
    ),
  }),
  Type.Object({ kind: Type.Literal("needs-sign-in") }),
  Type.Object({
    kind: Type.Literal("failed"),
    message: Type.String(),
    stderr: nullable(Type.String()),
  }),
]);

const McpServerViewType = Type.Object({
  name: Type.String(),
  scope: Type.Enum(["user", "project"]),
  path: Type.String(),
  override: nullable(Type.String()),
  transport: Type.Union([
    Type.Object({
      kind: Type.Literal("stdio"),
      command: Type.String(),
      args: Type.Array(Type.String()),
    }),
    Type.Object({ kind: Type.Literal("http"), url: Type.String() }),
  ]),
  exposure: ExposureType,
  description: nullable(Type.String()),
  state: McpServerStateType,
});

export const McpViewSchema: Schema<McpView> = standard(
  Type.Object({
    servers: Type.Array(McpServerViewType),
    issues: Type.Array(ValidationIssueType),
  }),
);

export const McpExposureNameType = Type.Enum([
  "direct",
  "deferred",
  "codemode",
  "codemode-deferred",
  "hidden",
]);

export const McpOAuthConfigType = Type.Object({
  clientId: Type.Optional(Type.String()),
  clientSecret: Type.Optional(Type.String()),
  callbackPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  callbackUrl: Type.Optional(Type.String()),
  clientName: Type.Optional(Type.String()),
  scope: Type.Optional(Type.String()),
  authServerMetadataUrl: Type.Optional(Type.String()),
});

const StringMap = Type.Record(Type.String(), Type.String());

const OPTIONS = {
  enabled: Type.Optional(Type.Boolean()),
  timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  description: Type.Optional(Type.String()),
  exposure: Type.Optional(McpExposureNameType),
  toolExposure: Type.Optional(Type.Record(Type.String(), McpExposureNameType)),
};

export const McpServerConfigType = Type.Union([
  Type.Object({
    ...OPTIONS,
    type: Type.Optional(Type.Literal("stdio")),
    command: Type.String({ minLength: 1 }),
    args: Type.Optional(Type.Array(Type.String())),
    env: Type.Optional(StringMap),
    cwd: Type.Optional(Type.String()),
  }),
  Type.Object({
    ...OPTIONS,
    type: Type.Optional(Type.Enum(["http", "streamable-http"])),
    url: Type.String({ minLength: 1 }),
    headers: Type.Optional(StringMap),
    oauth: Type.Optional(McpOAuthConfigType),
  }),
]);

export const McpServerConfigSchema: Schema<McpServerConfig> = standard(McpServerConfigType);

export const McpChangeSchema: Schema<McpChange> = standard(
  Type.Union([
    Type.Object({ kind: Type.Literal("updated") }),
    Type.Object({ kind: Type.Literal("missing") }),
    Type.Object({ kind: Type.Literal("invalid"), message: Type.String() }),
  ]),
);
