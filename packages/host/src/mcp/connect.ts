import { isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { StdioTransport, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import type { McpTransport } from "@earendil-works/pi-mcp";
import type { OAuthChallenge } from "@earendil-works/pi-mcp/oauth";
import type { McpWorkspace, PluginStorage } from "@nyte-ai/core";
import type { McpOAuthConfig } from "@nyte-ai/schema";
import type { McpServerEntry } from "./config.ts";
import { createAuthProvider, oauthKey, oauthStore } from "./oauth.ts";
import type { McpOAuthSettings } from "./oauth.ts";

/**
 * Opens the transport to one server for one workspace. A url server that
 * needs OAuth sends its stored tokens; when it needs a new sign-in the
 * connection fails with `McpOAuthAuthorizationRequiredError`, after passing
 * the server's challenge to `challenged`. Throws when the entry cannot be
 * started, such as a missing `${VAR}`.
 */
export type McpConnector = (
  entry: McpServerEntry,
  context: {
    readonly workspace: McpWorkspace;
    readonly home: string;
    readonly secrets: PluginStorage["secrets"];
    challenged(challenge: OAuthChallenge): void;
  },
) => McpTransport;

/**
 * Runs stdio servers on this machine, in `cwd` resolved against the
 * workspace folder, and connects to url servers over streamable HTTP. A url
 * server without an `Authorization` header signs in with OAuth.
 */
export const connectServer: McpConnector = (entry, context) => {
  const { transport } = entry;

  if (transport.kind === "stdio") {
    const base = context.workspace.root ?? context.home;
    const cwd = transport.cwd === null ? base : home(transport.cwd, context.home);

    return new StdioTransport({
      command: home(transport.command, context.home),
      args: transport.args.map((arg) => home(arg, context.home)),
      env: expand(transport.env, entry.name),
      cwd: isAbsolute(cwd) ? cwd : resolve(base, cwd),
      stderr: "pipe",
    });
  }

  const headers = expand(transport.headers, entry.name);

  if (Object.keys(headers).some((name) => name.toLowerCase() === "authorization"))
    return new StreamableHttpTransport({ url: transport.url, headers });

  return new StreamableHttpTransport({
    url: transport.url,
    headers,
    authProvider: createAuthProvider({
      serverUrl: transport.url,
      store: oauthStore(context.secrets, oauthKey(entry.name, transport.url)),
      settings: () => oauthSettings(transport.oauth, entry.name),
      onChallenge: context.challenged,
    }),
  });
};

/** A server's OAuth options with `${VAR}`s in `clientSecret` resolved. */
export function oauthSettings(config: McpOAuthConfig, server: string): McpOAuthSettings {
  const { clientSecret, authServerMetadataUrl, ...rest } = config;

  return {
    ...rest,
    ...(clientSecret === undefined
      ? {}
      : { clientSecret: expand({ clientSecret }, server).clientSecret }),
    ...(authServerMetadataUrl === undefined
      ? {}
      : { authServerMetadataUrl: new URL(authServerMetadataUrl) }),
  };
}

function home(path: string, directory: string): string {
  if (path === "~") return directory;

  return path.startsWith("~/") ? join(directory, path.slice(2)) : path;
}

function expand(values: Readonly<Record<string, string>>, server: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name: string) => {
        const found = process.env[name];

        if (found === undefined)
          throw new Error(`${server} needs the environment variable ${name}.`);

        return found;
      }),
    ]),
  );
}
