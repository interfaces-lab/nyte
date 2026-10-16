import type { ValidationIssue } from "./errors.ts";

/**
 * How a server's tools reach the model. `model` declares them, `deferred`
 * leaves them for tool search, `code` makes them callable only from codemode
 * scripts (the default), and `hidden` makes them unreachable.
 */
export type McpExposure = "model" | "deferred" | "code" | "hidden";

/** `user` servers come from `~/.nyte/mcp.json`; `project` servers from a trusted workspace's `.nyte/mcp.json`. */
export type McpScope = "user" | "project";

/**
 * A server's connection. `needs-sign-in` waits for the user: offer
 * `workspace(id).mcp.login(name)`, and the server connects once it is done.
 * Show `failed` with `message`, and `stderr` when a stdio server wrote any.
 */
export type McpServerState =
  | { readonly kind: "disabled" }
  | { readonly kind: "connecting" }
  | { readonly kind: "connected"; readonly tools: readonly McpToolView[] }
  | { readonly kind: "needs-sign-in" }
  | { readonly kind: "failed"; readonly message: string; readonly stderr: string | null };

/** One tool as the server lists it; sessions see it as `mcp__<server>__<name>`. */
export type McpToolView = {
  readonly name: string;
  readonly description: string;
  readonly exposure: McpExposure;
};

/** One configured server, with where it is defined and its connection now. */
export type McpServerView = {
  readonly name: string;
  readonly scope: McpScope;
  /** The `mcp.json` that defines the server. */
  readonly path: string;
  /** The project `mcp.json` whose override entry changes this user-level server, or `null`. */
  readonly override: string | null;
  readonly transport:
    | { readonly kind: "stdio"; readonly command: string; readonly args: readonly string[] }
    | { readonly kind: "http"; readonly url: string };
  readonly exposure: McpExposure;
  readonly description: string | null;
  readonly state: McpServerState;
};

/**
 * What `workspace(id).mcp()` yields: every server the workspace sees, sorted
 * by name, and the problems found reading its `mcp.json` files or the tools
 * its servers list. An invalid entry appears in `issues` and not in
 * `servers`; the others still connect. A listed tool whose input schema is
 * not JSON Schema appears in `issues` and not in its server's tools.
 */
export type McpView = {
  readonly servers: readonly McpServerView[];
  readonly issues: readonly ValidationIssue[];
};

/** An exposure as `mcp.json` names it: `direct` is `model`, `codemode` (or `codemode-deferred`) is `code`. */
export type McpExposureName = "direct" | "deferred" | "codemode" | "codemode-deferred" | "hidden";

/**
 * How Nyte signs in to a url server that uses OAuth. Without it, Nyte
 * registers itself as "Nyte" on a free loopback port. Set `clientId` (and
 * `clientSecret`, which may name `${VAR}`) with `callbackPort` or
 * `callbackUrl` for a server that needs a registered client, `clientName`
 * for one that accepts only known names, `scope` for one that does not
 * advertise its scopes, and `authServerMetadataUrl` for one that advertises
 * the wrong authorization server.
 */
export type McpOAuthConfig = {
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly callbackPort?: number;
  readonly callbackUrl?: string;
  readonly clientName?: string;
  readonly scope?: string;
  readonly authServerMetadataUrl?: string;
};

type McpServerOptions = {
  readonly enabled?: boolean;
  /** Seconds each request may take; progress notifications restart it. Default 60. */
  readonly timeout?: number;
  readonly description?: string;
  readonly exposure?: McpExposureName;
  /** Exposure per tool name; `*` matches any characters, exact names win, then the first matching pattern. */
  readonly toolExposure?: Readonly<Record<string, McpExposureName>>;
};

/**
 * One `mcpServers` entry of `mcp.json`, the format other MCP clients use: a
 * `command` run over stdio, or a streamable HTTP `url`. `env`, `headers` and
 * `oauth.clientSecret` may name `${VAR}` environment variables.
 */
export type McpServerConfig =
  | (McpServerOptions & {
      readonly type?: "stdio";
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Readonly<Record<string, string>>;
      readonly cwd?: string;
    })
  | (McpServerOptions & {
      readonly type?: "http" | "streamable-http";
      readonly url: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly oauth?: McpOAuthConfig;
    });

/** What an MCP action did: `missing` names no configured server, `invalid` explains a refused change. */
export type McpChange =
  | { readonly kind: "updated" }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly message: string };
