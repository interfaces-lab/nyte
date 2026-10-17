import { Type } from "typebox";
import { ValidationIssueType } from "./errors.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export const McpExposureType = Type.Enum(["model", "deferred", "code", "hidden"]);

/**
 * How a server's tools reach the model. `model` declares them, `deferred`
 * leaves them for tool search, `code` makes them callable only from codemode
 * scripts (the default), and `hidden` makes them unreachable.
 */
export type McpExposure = Decoded<typeof McpExposureType>;

export const McpScopeType = Type.Enum(["user", "project"]);

/** `user` servers come from `~/.nyte/mcp.json`; `project` servers from a trusted workspace's `.nyte/mcp.json`. */
export type McpScope = Decoded<typeof McpScopeType>;

export const McpToolViewType = Type.Object({
  name: Type.String(),
  description: Type.String(),
  exposure: McpExposureType,
});

/** One tool as the server lists it; sessions see it as `mcp__<server>__<name>`. */
export type McpToolView = Decoded<typeof McpToolViewType>;

export const McpServerStateType = Type.Union([
  Type.Object({ kind: Type.Literal("disabled") }),
  Type.Object({ kind: Type.Literal("connecting") }),
  Type.Object({ kind: Type.Literal("connected"), tools: Type.Array(McpToolViewType) }),
  Type.Object({ kind: Type.Literal("needs-sign-in") }),
  Type.Object({
    kind: Type.Literal("failed"),
    message: Type.String(),
    stderr: nullable(Type.String()),
  }),
]);

/**
 * A server's connection. `needs-sign-in` waits for the user: offer
 * `workspace(id).mcp.login(name)`, and the server connects once it is done.
 * Show `failed` with `message`, and `stderr` when a stdio server wrote any.
 */
export type McpServerState = Decoded<typeof McpServerStateType>;

export const McpServerViewType = Type.Object({
  name: Type.String(),
  scope: McpScopeType,
  /** The `mcp.json` that defines the server. */
  path: Type.String(),
  /** The project `mcp.json` whose override entry changes this user-level server, or `null`. */
  override: nullable(Type.String()),
  transport: Type.Union([
    Type.Object({
      kind: Type.Literal("stdio"),
      command: Type.String(),
      args: Type.Array(Type.String()),
    }),
    Type.Object({ kind: Type.Literal("http"), url: Type.String() }),
  ]),
  exposure: McpExposureType,
  description: nullable(Type.String()),
  state: McpServerStateType,
});

/** One configured server, with where it is defined and its connection now. */
export type McpServerView = Decoded<typeof McpServerViewType>;

export const McpViewType = Type.Object({
  servers: Type.Array(McpServerViewType),
  issues: Type.Array(ValidationIssueType),
});

/**
 * What `workspace(id).mcp()` yields: every server the workspace sees, sorted
 * by name, and the problems found reading its `mcp.json` files or the tools
 * its servers list. An invalid entry appears in `issues` and not in
 * `servers`; the others still connect. A listed tool whose input schema is
 * not JSON Schema appears in `issues` and not in its server's tools.
 */
export type McpView = Decoded<typeof McpViewType>;

export const McpExposureNameType = Type.Enum([
  "direct",
  "deferred",
  "codemode",
  "codemode-deferred",
  "hidden",
]);

/** An exposure as `mcp.json` names it: `direct` is `model`, `codemode` (or `codemode-deferred`) is `code`. */
export type McpExposureName = Decoded<typeof McpExposureNameType>;

export const McpOAuthConfigType = Type.Object({
  clientId: Type.Optional(Type.String()),
  clientSecret: Type.Optional(Type.String()),
  callbackPort: Type.Optional(Type.Integer({ minimum: 1, maximum: 65535 })),
  callbackUrl: Type.Optional(Type.String()),
  clientName: Type.Optional(Type.String()),
  scope: Type.Optional(Type.String()),
  authServerMetadataUrl: Type.Optional(Type.String()),
});

/**
 * How Nyte signs in to a url server that uses OAuth. Without it, Nyte
 * registers itself as "Nyte" on a free loopback port. Set `clientId` (and
 * `clientSecret`, which may name `${VAR}`) with `callbackPort` or
 * `callbackUrl` for a server that needs a registered client, `clientName`
 * for one that accepts only known names, `scope` for one that does not
 * advertise its scopes, and `authServerMetadataUrl` for one that advertises
 * the wrong authorization server.
 */
export type McpOAuthConfig = Decoded<typeof McpOAuthConfigType>;

const StringMap = Type.Record(Type.String(), Type.String());

const OPTIONS = {
  enabled: Type.Optional(Type.Boolean()),
  /** Seconds each request may take; progress notifications restart it. Default 60. */
  timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  description: Type.Optional(Type.String()),
  exposure: Type.Optional(McpExposureNameType),
  /** Exposure per tool name; `*` matches any characters, exact names win, then the first matching pattern. */
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

/**
 * One `mcpServers` entry of `mcp.json`, the format other MCP clients use: a
 * `command` run over stdio, or a streamable HTTP `url`. `env`, `headers` and
 * `oauth.clientSecret` may name `${VAR}` environment variables.
 */
export type McpServerConfig = Decoded<typeof McpServerConfigType>;

export const McpChangeType = Type.Union([
  Type.Object({ kind: Type.Literal("updated") }),
  Type.Object({ kind: Type.Literal("missing") }),
  Type.Object({ kind: Type.Literal("invalid"), message: Type.String() }),
]);

/** What an MCP action did: `missing` names no configured server, `invalid` explains a refused change. */
export type McpChange = Decoded<typeof McpChangeType>;

export const McpViewSchema: Schema<McpView> = standard(McpViewType);

export const McpServerConfigSchema: Schema<McpServerConfig> = standard(McpServerConfigType);

export const McpChangeSchema: Schema<McpChange> = standard(McpChangeType);
