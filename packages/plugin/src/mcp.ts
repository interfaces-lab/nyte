import { McpClient, StdioTransport, StreamableHttpTransport } from "@earendil-works/pi-mcp";
import type { CallToolResult, McpTransport, Tool } from "@earendil-works/pi-mcp";
import {
  McpOAuthProvider,
  OAuthCallbackServer,
  adaptOAuthProvider,
  authorizeMcp,
} from "@earendil-works/pi-mcp/oauth";
import type { McpOAuthStateStore } from "@earendil-works/pi-mcp/oauth";
import { dev } from "@nyte-ai/core";
import type { ExecutionEnv, PluginStorage, SettingDefinition, ToolDefinition } from "@nyte-ai/core";
import { isJson, standard } from "@nyte-ai/schema";
import type { Json, Schema, ToolContent } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { Plugin } from "./core.ts";

const serverConfig = Type.Union([
  Type.Object({
    command: Type.String(),
    args: Type.Optional(Type.Array(Type.String())),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
    cwd: Type.Optional(Type.String()),
  }),
  Type.Object({
    url: Type.String(),
    headers: Type.Optional(Type.Record(Type.String(), Type.String())),
  }),
]);

const serversSchema = Type.Record(Type.String(), serverConfig);

/**
 * Describes one MCP server: a command run over stdio, or a streamable HTTP
 * url with optional headers.
 *
 * @category plugins
 * @since 0.1.0
 */
export type McpServerConfig = Static<typeof serverConfig>;

/**
 * Opens the transport to one configured server; the default runs stdio
 * commands in the session's working directory and connects to urls.
 *
 * @category plugins
 * @since 0.1.0
 */
export type McpConnector = (
  server: string,
  config: McpServerConfig,
  context: { readonly cwd: string; readonly storage: PluginStorage; signIn(url: URL): void },
) => McpTransport;

const servers: SettingDefinition<Static<typeof serversSchema>> = {
  id: "mcp.servers",
  label: "MCP servers",
  schema: standard(serversSchema),
  default: {},
  scope: "host",
};

const tokens = Type.Object({
  access_token: Type.String(),
  token_type: Type.String(),
  expires_in: Type.Optional(Type.Number()),
  scope: Type.Optional(Type.String()),
  refresh_token: Type.Optional(Type.String()),
  id_token: Type.Optional(Type.String()),
});

const oauthState = Type.Object({
  serverUrl: Type.String(),
  clientInformation: Type.Optional(
    Type.Object({
      client_id: Type.String(),
      client_secret: Type.Optional(Type.String()),
      client_id_issued_at: Type.Optional(Type.Number()),
      client_secret_expires_at: Type.Optional(Type.Number()),
    }),
  ),
  tokens: Type.Optional(tokens),
  tokensExpireAt: Type.Optional(Type.Number()),
  codeVerifier: Type.Optional(Type.String()),
  oauthState: Type.Optional(Type.String()),
});

const CALLBACK = { port: 19876, path: "/mcp/oauth/callback" } as const;

/** The sign-in each server url is waiting on, so a reconnect while the user signs in does not open a second one. */
const signIns = new Map<string, Promise<void>>();

/**
 * Returns one live connection to an MCP server, the link the plugin keeps
 * per configured server: it connects, lists the server's tools, follows
 * `tools/list_changed`, and reconnects with backoff after the link drops.
 *
 * @category plugins
 * @since 0.1.0
 */
export interface McpLink {
  readonly server: string;
  /** The server's tools as session tools; empty until connected and after a drop. */
  tools(): readonly ToolDefinition[];
  /** Closes the link for good. */
  close(): Promise<void>;
}

/**
 * Opens a link over `connect`. `changed` runs whenever the tool set moves
 * (connected, listed again, dropped); `failed` runs with a message when
 * connecting or the link fails, before the next attempt. `env` is read only
 * when a tool result carries an image to upload.
 *
 * @category plugins
 * @since 0.1.0
 */
export function openLink(input: {
  readonly server: string;
  readonly env: () => ExecutionEnv;
  connect(): McpTransport;
  changed(): void;
  failed(message: string): void;
}): McpLink {
  const { server } = input;
  let listed: readonly ToolDefinition[] = [];
  let client: McpClient | null = null;
  let closed = false;
  let delay = 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const retry = (message: string): void => {
    dev("mcp", "link failed", { server, retryIn: closed ? null : delay });
    listed = [];
    client = null;
    input.changed();
    input.failed(message);

    if (closed) return;
    timer = setTimeout(() => void connect(), delay);
    delay = Math.min(delay * 2, 30_000);
  };

  const connect = async (): Promise<void> => {
    const next = new McpClient({ name: "nyte", version: "0.1.0", requestTimeoutMs: 30_000 });
    next.onClose(() => {
      if (!closed && client === next) retry(`The link to ${server} closed.`);
    });

    try {
      await next.connect(input.connect());

      if (closed) {
        await next.close();

        return;
      }

      const refresh = async (): Promise<void> => {
        const listedTools = await next.listTools();

        if (closed || client !== next) return;
        listed = listedTools.map((tool) => bridge(server, tool, next, input.env));
        dev("mcp", "tools listed", { server, tools: listed.length });
        input.changed();
      };

      client = next;
      delay = 1000;
      next.onNotification(
        "notifications/tools/list_changed",
        () => void refresh().catch((error: unknown) => retry(messageOf(error))),
      );
      await refresh();
    } catch (error) {
      if (client === next) client = null;
      await next.close().catch(() => undefined);

      if (!closed) retry(`${server} failed to connect: ${messageOf(error)}`);
    }
  };

  void connect();

  return {
    server,
    tools: () => listed,
    async close() {
      closed = true;
      clearTimeout(timer);
      listed = [];
      await client?.close();
    },
  };
}

/** Returns an MCP tool as a session tool named `<server>_<tool>` in namespace `mcp/<server>`, called over the link's client. */
function bridge(
  server: string,
  tool: Tool,
  client: McpClient,
  env: () => ExecutionEnv,
): ToolDefinition {
  const output = tool.outputSchema;

  return {
    name: `${server}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64),
    namespace: `mcp/${server}`,
    description: tool.description ?? tool.title ?? tool.name,
    parameters: passthrough(tool.inputSchema),
    ...(output === undefined ? {} : { output: passthrough(output) }),
    class: () => ({ kind: "custom", label: `${server}: ${tool.title ?? tool.name}` }),
    replay:
      tool.annotations?.readOnlyHint === true || tool.annotations?.idempotentHint === true
        ? "safe"
        : "never",
    async execute(args, invocation) {
      const result = await client.callTool(tool.name, isObject(args) ? args : {}, {
        signal: invocation.signal,
        timeoutMs: 12 * 60 * 60 * 1000,
      });
      const content = await contentOf(result, env);

      if (result.isError === true)
        throw new Error(
          content.flatMap((item) => (item.kind === "text" ? [item.text] : [])).join("\n") ||
            `${tool.name} failed.`,
        );

      const structured = result.structuredContent;

      return {
        content,
        ...(output !== undefined && isJson(structured) ? { output: structured } : {}),
      };
    },
  };
}

/** Returns an MCP result's content as tool content: text as text, images uploaded through the environment, anything else as its JSON. */
async function contentOf(result: CallToolResult, env: () => ExecutionEnv): Promise<ToolContent[]> {
  const content: ToolContent[] = [];

  for (const block of result.content) {
    if (block.type === "text") content.push({ kind: "text", text: block.text });
    else if (block.type === "image")
      content.push({
        kind: "file",
        blob: await env().files.upload(once(Uint8Array.fromBase64(block.data))),
        mime: block.mimeType,
      });
    else content.push({ kind: "text", text: JSON.stringify(block) });
  }

  return content;
}

/** Returns a schema that declares a server's JSON Schema as given and accepts any JSON object; the server validates its own arguments. */
function passthrough(json: Record<string, unknown>): Schema<Json> {
  return {
    "~standard": {
      version: 1,
      vendor: "mcp",
      validate: (value) =>
        isJson(value) && isObject(value)
          ? { value }
          : { issues: [{ message: "Expected a JSON object." }] },
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

/** Returns true for a plain object. */
function isObject(value: unknown): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && isJson(value);
}

/** Returns an error's message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Returns one chunk as a stream, for `files.upload`. */
async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}

/** Returns an OAuth state store over the plugin's secrets, one entry per server; discovery is not kept and is found again. */
function oauthStore(storage: PluginStorage, server: string): McpOAuthStateStore {
  const key = `oauth:${server}`;

  return {
    async load() {
      const text = await storage.secrets.get(key);
      const parsed: unknown = text === undefined ? undefined : JSON.parse(text);

      return Value.Check(oauthState, parsed) ? parsed : undefined;
    },
    save: (state) => storage.secrets.set(key, JSON.stringify({ ...state, discovery: undefined })),
  };
}

/**
 * Opens stdio servers with their command in the session's working directory
 * and url servers over streamable HTTP, signing in with OAuth when the
 * server asks: the tokens live in the plugin's secrets.
 *
 * @category plugins
 * @since 0.1.0
 */
export const connectServer: McpConnector = (server, config, context) => {
  if ("command" in config)
    return new StdioTransport({
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd ?? context.cwd,
      stderr: "pipe",
    });

  const provider = new McpOAuthProvider({
    serverUrl: config.url,
    redirectUrl: `http://127.0.0.1:${CALLBACK.port}${CALLBACK.path}`,
    clientMetadata: { client_name: "Nyte" },
    store: oauthStore(context.storage, server),
    onRedirect(url) {
      if (signIns.has(config.url)) return;
      dev("mcp", "sign-in", { server });
      context.signIn(url);

      const signedIn = (async () => {
        const callback = await OAuthCallbackServer.listen({
          ...CALLBACK,
          timeoutMs: 5 * 60 * 1000,
        });

        try {
          const { code } = await callback.waitForCallback(await provider.state());
          await authorizeMcp(provider, { serverUrl: config.url, authorizationCode: code });
        } finally {
          await callback.close();
        }
      })();

      signIns.set(
        config.url,
        signedIn.catch(() => undefined).finally(() => signIns.delete(config.url)),
      );
    },
  });

  return new StreamableHttpTransport({
    url: config.url,
    headers: config.headers,
    authProvider: adaptOAuthProvider(provider),
  });
};

/**
 * Returns the MCP plugin over a connector; the default export uses
 * `connectServer`. Each server in the host setting `mcp.servers` gets a
 * link whose tools a derive puts in the session as `<server>_<tool>`; a link
 * that connects, drops or lists again calls `api.reload()`, and a failure is
 * reported on `HostView.plugins[].issues`.
 *
 * @category plugins
 * @since 0.1.0
 */
export function mcpPlugin(connect: McpConnector): Plugin {
  return {
    id: "mcp",
    contribute: { settings: [servers] },
    activate(api) {
      const links = new Map<string, { readonly config: string; readonly link: McpLink }>();

      api.contribute.tools.add((draft) => {
        for (const { link } of links.values())
          for (const tool of link.tools()) draft.set(tool.name, tool);
      });

      const sync = (value: unknown): void => {
        const wanted = Value.Check(serversSchema, value) ? value : {};

        for (const [server, held] of links) {
          if (held.config === JSON.stringify(wanted[server])) continue;
          links.delete(server);
          void held.link.close();
        }

        for (const [server, config] of Object.entries(wanted)) {
          if (links.has(server)) continue;

          const link = openLink({
            server,
            env: () => api.env,
            connect: () =>
              connect(server, config, {
                cwd: api.env.cwd,
                storage: api.storage,
                signIn: (url) =>
                  api.report({
                    severity: "warning",
                    path: ["mcp.servers", server],
                    message: `Sign in to ${server}: ${url.href}`,
                    source: { plugin: "mcp" },
                  }),
              }),
            changed: () => api.reload(),
            failed: (message) =>
              api.report({
                severity: "warning",
                path: ["mcp.servers", server],
                message,
                source: { plugin: "mcp" },
              }),
          });

          links.set(server, { config: JSON.stringify(config), link });
        }

        api.reload();
      };

      api.signal.addEventListener("abort", () => {
        for (const { link } of links.values()) void link.close();
        links.clear();
      });

      void (async () => {
        for await (const value of api.contribute.settings.watch(servers.id)) sync(value);
      })();
    },
  };
}

/**
 * The MCP plugin over stdio and streamable HTTP.
 *
 * @category plugins
 * @since 0.1.0
 */
export default mcpPlugin(connectServer) satisfies Plugin;
