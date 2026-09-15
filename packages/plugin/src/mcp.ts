/**
 * The process owns MCP connections; a session owns the choice of which to use.
 * `McpServers` pools one connection per server config for every session, and
 * `mcpPlugin` turns a session's on/off settings into acquire and release on
 * that pool, offering whatever is connected as tools.
 *
 * A server therefore outlives any one session, and a plugin reload that leaves
 * its config alone never reconnects: the plugin's version is the config's hash.
 *
 * Modeled on opencode v2 `packages/core/src/mcp` and `tool/mcp.ts`, without
 * OAuth, resources, or prompts: connect, list tools, call tools.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { definePlugin, pluginFactKey } from "@nyte-ai/core/plugins";
import type { AgentTool, Disposer } from "@nyte-ai/core/plugins";
import type { ImageContent, JsonValue, TextContent } from "@nyte-ai/schema";
import { Type, Unsafe } from "typebox";
import type { Static } from "typebox";

export const MCP_PLUGIN_ID = "mcp";

// The SDK brings zod, ajv, and its transports: a third of the desktop's main
// bundle. It loads on the first connection, the way provider SDKs do.
async function importSdk() {
  const [client, stdio, http, types] = await Promise.all([
    import("@modelcontextprotocol/sdk/client/index.js"),
    import("@modelcontextprotocol/sdk/client/stdio.js"),
    import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
    import("@modelcontextprotocol/sdk/types.js"),
  ]);
  return {
    Client: client.Client,
    StdioClientTransport: stdio.StdioClientTransport,
    getDefaultEnvironment: stdio.getDefaultEnvironment,
    StreamableHTTPClientTransport: http.StreamableHTTPClientTransport,
    CallToolResultSchema: types.CallToolResultSchema,
    ToolListChangedNotificationSchema: types.ToolListChangedNotificationSchema,
  };
}
type Sdk = Awaited<ReturnType<typeof importSdk>>;

let sdk: Promise<Sdk> | undefined;
function loadSdk(): Promise<Sdk> {
  sdk ??= importSdk();
  return sdk;
}

/** A server the host starts over stdio, or one it reaches over streamable HTTP. */
export const McpServerConfig = Type.Union([
  Type.Object(
    {
      command: Type.String({ minLength: 1 }),
      args: Type.Optional(Type.Array(Type.String())),
      env: Type.Optional(Type.Record(Type.String(), Type.String())),
      /** Relative paths resolve from the session's working directory. */
      cwd: Type.Optional(Type.String()),
      disabled: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      url: Type.String({ minLength: 1 }),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
      disabled: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
]);
export type McpServerConfig = Static<typeof McpServerConfig>;
export type McpConfig = Readonly<Record<string, McpServerConfig>>;

const STARTUP_TIMEOUT_MS = 30_000;
/**
 * How long session activation waits for servers to connect. A healthy server answers
 * well inside it; past it the session opens without those tools rather than holding the
 * first message behind a slow or broken server, and they arrive with its status change.
 */
const ACTIVATION_WAIT_MS = 2_000;
const CATALOG_TIMEOUT_MS = 30_000;
/** Tool calls run as long as the model's turn does; the turn's signal ends them. */
const CALL_TIMEOUT_MS = 12 * 60 * 60 * 1_000;
/** A reload disposes a session's handle just before the next one acquires it. */
const LINGER_MS = 1_000;
const STDERR_TAIL_BYTES = 2_048;

export type McpServerStatus =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "connected";
      readonly tools: readonly AgentTool[];
      readonly instructions: string | undefined;
    }
  | { readonly kind: "failed"; readonly error: string };

export interface McpServerHandle {
  readonly name: string;
  status(): McpServerStatus;
  /** Resolves once the server is connected or has failed; never rejects. */
  ready(): Promise<void>;
  /** Fires on every status change until the handle is released. */
  subscribe(listener: () => void): Disposer;
  release(): void;
}

interface Connection {
  status: McpServerStatus;
  /** Undefined while connecting, the client once open, `"ended"` once closed for good. */
  client: Client | "ended" | undefined;
  readonly ready: Promise<void>;
  settle: () => void;
}

/** One configured server: sessions hold it; its connection is replaced on retry. */
class Slot {
  readonly name: string;
  readonly config: McpServerConfig;
  readonly cwd: string;
  refs = 0;
  linger: ReturnType<typeof setTimeout> | undefined;
  readonly listeners = new Set<() => void>();
  connection: Connection;

  constructor(name: string, config: McpServerConfig, cwd: string) {
    this.name = name;
    this.config = config;
    this.cwd = cwd;
    this.connection = openConnection(this);
  }
}

export function connectionKey(name: string, config: McpServerConfig, cwd: string): string {
  const resolved =
    "command" in config ? { ...config, cwd: resolve(cwd, config.cwd ?? ".") } : config;
  return `${name}\u0000${JSON.stringify(resolved)}`;
}

export class McpServers {
  private readonly slots = new Map<string, Slot>();

  acquire(name: string, config: McpServerConfig, cwd: string): McpServerHandle {
    const key = connectionKey(name, config, cwd);
    const held = this.slots.get(key) ?? new Slot(name, config, cwd);
    this.slots.set(key, held);
    // A config change re-acquires; give a failed server another try then.
    if (held.connection.status.kind === "failed") held.connection = openConnection(held);
    held.refs += 1;
    clearTimeout(held.linger);
    held.linger = undefined;
    let released = false;
    const listeners = new Set<() => void>();
    return {
      name,
      status: () => held.connection.status,
      ready: () => held.connection.ready,
      subscribe: (listener) => {
        held.listeners.add(listener);
        listeners.add(listener);
        return () => {
          held.listeners.delete(listener);
        };
      },
      release: () => {
        if (released) return;
        released = true;
        for (const listener of listeners) held.listeners.delete(listener);
        held.refs -= 1;
        if (held.refs > 0) return;
        held.linger = setTimeout(() => {
          if (held.refs > 0) return;
          if (this.slots.get(key) === held) this.slots.delete(key);
          void closeConnection(held.connection);
        }, LINGER_MS);
        held.linger.unref();
      },
    };
  }

  /** Reopen every failed connection in place; sessions keep their handles. */
  reconnectFailed(): void {
    for (const slot of this.slots.values()) {
      if (slot.connection.status.kind === "failed") slot.connection = openConnection(slot);
    }
  }

  async close(): Promise<void> {
    const all = [...this.slots.values()];
    this.slots.clear();
    for (const slot of all) clearTimeout(slot.linger);
    await Promise.all(all.map((slot) => closeConnection(slot.connection)));
  }
}

function openConnection(slot: Slot): Connection {
  const { promise: ready, resolve: settle } = Promise.withResolvers<void>();
  const connection: Connection = {
    status: { kind: "connecting" },
    client: undefined,
    ready,
    settle,
  };
  notify(slot);
  void connectServer(slot, connection)
    .catch((cause: unknown) => {
      fail(slot, connection, errorMessage(cause));
    })
    .finally(() => connection.settle());
  return connection;
}

/** Terminal: a connect still in flight sees `"ended"` and closes the client it opened. */
async function closeConnection(connection: Connection): Promise<void> {
  const { client } = connection;
  connection.client = "ended";
  if (client === undefined || client === "ended") return;
  await client.close().catch(() => undefined);
}

function notify(slot: Slot): void {
  for (const listener of slot.listeners) listener();
}

function fail(slot: Slot, connection: Connection, error: string): void {
  // The transport closing and the request it failed both report; the first says why.
  if (connection.status.kind === "failed") return;
  connection.status = { kind: "failed", error };
  void closeConnection(connection);
  connection.settle();
  if (slot.connection === connection) notify(slot);
}

async function connectServer(slot: Slot, connection: Connection): Promise<void> {
  const { config, cwd } = slot;
  // `closeConnection` reassigns the property while this function awaits; reading it through a
  // closure keeps the declared type, which the compiler's flow analysis would otherwise narrow away.
  const ended = (): boolean => connection.client === "ended";
  const { Client, StdioClientTransport, getDefaultEnvironment, StreamableHTTPClientTransport } =
    await loadSdk();
  // Loading the SDK is the only window where a close finds no client to shut down. Past it,
  // `connection.client` is set before `connect` spawns the server, so a close reaches it.
  if (ended()) return;
  const client = new Client({ name: "nyte", version: "0" });
  let stderrTail = "";
  const transport =
    "command" in config
      ? new StdioClientTransport({
          command: config.command,
          args: config.args ?? [],
          env: { ...getDefaultEnvironment(), ...config.env },
          cwd: resolve(cwd, config.cwd ?? "."),
          // The terminal owns stderr; the server's goes into its failure message instead.
          stderr: "pipe",
        })
      : new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: config.headers === undefined ? undefined : { headers: config.headers },
        });
  if (transport instanceof StdioClientTransport) {
    transport.stderr?.on("data", (chunk: Buffer | string) => {
      stderrTail = (stderrTail + String(chunk)).slice(-STDERR_TAIL_BYTES);
    });
  }
  const describe = (message: string): string =>
    stderrTail.trim() === "" ? message : `${message}\n${stderrTail.trim()}`;
  connection.client = client;
  // The MCP client exposes callback properties, not an EventTarget.
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  client.onclose = () => {
    if (connection.client !== client) return;
    fail(slot, connection, describe("connection closed"));
  };
  // oxlint-disable-next-line unicorn/prefer-add-event-listener
  client.onerror = () => undefined;
  try {
    await client.connect(transport, { timeout: STARTUP_TIMEOUT_MS });
  } catch (cause) {
    throw new Error(describe(errorMessage(cause)), { cause });
  }
  const refresh = async (): Promise<void> => {
    const tools = await listTools(client, slot.name);
    if (connection.client !== client) return;
    connection.status = {
      kind: "connected",
      tools,
      instructions: client.getInstructions()?.trim() || undefined,
    };
    if (slot.connection === connection) notify(slot);
  };
  const { ToolListChangedNotificationSchema } = await loadSdk();
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    void refresh().catch((cause: unknown) => {
      if (connection.client === client) fail(slot, connection, describe(errorMessage(cause)));
    });
  });
  await refresh();
}

async function listTools(client: Client, server: string): Promise<AgentTool[]> {
  if (client.getServerCapabilities()?.tools === undefined) return [];
  const tools: Tool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor === undefined ? undefined : { cursor }, {
      timeout: CATALOG_TIMEOUT_MS,
    });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return tools.map((tool) => bridgeTool(client, server, tool));
}

/** `server_tool`, in the character set every provider accepts for a tool name. */
export function bridgedToolName(server: string, tool: string): string {
  return `${server}_${tool}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}

function bridgeTool(client: Client, server: string, tool: Tool): AgentTool {
  const name = bridgedToolName(server, tool.name);
  return {
    name,
    description: tool.description ?? "",
    parameters: Unsafe<Record<string, JsonValue>>({ ...tool.inputSchema }),
    replay: "never",
    async execute(_toolCallId, params, signal) {
      // The registry validated `params` against `inputSchema`, an object schema.
      if (!isRecord(params)) throw new Error(`${name} expects an object`);
      // The client's return type is a union with the legacy shape; parse the modern one.
      const { CallToolResultSchema } = await loadSdk();
      const result = CallToolResultSchema.parse(
        await client.callTool({ name: tool.name, arguments: params }, CallToolResultSchema, {
          signal,
          timeout: CALL_TIMEOUT_MS,
        }),
      );
      const content = toolContent(result.content);
      if (result.isError === true) {
        throw new Error(
          content
            .flatMap((item) => (item.type === "text" ? [item.text] : []))
            .join("\n")
            .trim() || `${tool.name} failed`,
        );
      }
      return { content, details: { server, tool: tool.name }, title: tool.name };
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolContent(content: CallToolResult["content"]): (TextContent | ImageContent)[] {
  return content.flatMap((block): (TextContent | ImageContent)[] => {
    switch (block.type) {
      case "text":
        return [{ type: "text", text: block.text }];
      case "image":
        return [{ type: "image", data: block.data, mimeType: block.mimeType }];
      case "audio":
        return [{ type: "text", text: `[audio ${block.mimeType}]` }];
      case "resource":
        return [
          {
            type: "text",
            text:
              "text" in block.resource ? block.resource.text : `[resource ${block.resource.uri}]`,
          },
        ];
      case "resource_link":
        return [{ type: "text", text: `[resource ${block.uri}]` }];
      default: {
        const _exhaustive: never = block;
        return _exhaustive;
      }
    }
  });
}

function firstLine(text: string): string {
  return text.split("\n", 1)[0] ?? text;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Stable across processes and hosts: the same config gives the same version. */
export function mcpConfigVersion(config: McpConfig): string {
  const names = Object.keys(config).toSorted();
  const canonical = JSON.stringify(names.map((name) => [name, config[name]]));
  return `mcp:${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

/** The session setting that turns one configured server on or off. */
export function mcpServerSettingId(name: string): string {
  return `mcp:${name}`;
}

function enabledKey(name: string): string {
  return `enabled:${name}`;
}

/** The manifest's `disabled` is only the choice a session starts from. */
function defaultChoice(config: McpServerConfig): "on" | "off" {
  return config.disabled === true ? "off" : "on";
}

function isEnabled(stored: JsonValue | undefined, config: McpServerConfig): boolean {
  return (stored === "on" || stored === "off" ? stored : defaultChoice(config)) === "on";
}

export function mcpPlugin(input: { readonly servers: McpServers; readonly config: McpConfig }) {
  return definePlugin({
    id: MCP_PLUGIN_ID,
    async session(api) {
      const configured = Object.entries(input.config);

      // 1. Each server is a setting; the manifest's `disabled` is its default.
      api.settings.add((draft) => {
        for (const [name, config] of configured) {
          draft.set(mcpServerSettingId(name), {
            label: `MCP · ${name}`,
            key: enabledKey(name),
            fallback: defaultChoice(config),
            choices: [
              { id: "on", label: "on", description: "Connected; its tools are offered" },
              { id: "off", label: "off", description: "Disconnected; its tools are hidden" },
            ],
          });
        }
      });

      // 2. One pool handle per server that is on; a failure is warned once.
      const active = new Map<string, McpServerHandle>();
      const reported = new Map<string, string>();
      const refresh = (): void => {
        for (const handle of active.values()) {
          const status = handle.status();
          if (status.kind !== "failed" || reported.get(handle.name) === status.error) continue;
          reported.set(handle.name, status.error);
          api.diagnostics.warn(`MCP server ${handle.name}: ${status.error}`);
        }
        api.tools.rebuild();
        api.prompt.rebuild();
      };
      const apply = (name: string, config: McpServerConfig, enabled: boolean): void => {
        const current = active.get(name);
        if (enabled && current === undefined) {
          const handle = input.servers.acquire(name, config, api.env.cwd);
          handle.subscribe(refresh);
          active.set(name, handle);
        } else if (!enabled && current !== undefined) {
          active.delete(name);
          reported.delete(name);
          current.release();
        }
      };
      // 3. A choice is a session fact, so its event carries the new value.
      const byFact = new Map(
        configured.map((entry) => [pluginFactKey(MCP_PLUGIN_ID, enabledKey(entry[0])), entry]),
      );
      api.signal.addEventListener(
        "abort",
        api.events.subscribe((event) => {
          if (event.kind !== "fact") return;
          const entry = byFact.get(event.key);
          if (entry === undefined) return;
          const [name, config] = entry;
          apply(name, config, isEnabled(event.value, config));
          refresh();
        }),
      );
      api.signal.addEventListener("abort", () => {
        for (const handle of active.values()) handle.release();
      });

      // 4. What the session sees: connected servers' tools and instructions, and `/mcp`.
      api.tools.add((draft) => {
        for (const handle of active.values()) {
          const status = handle.status();
          if (status.kind !== "connected") continue;
          for (const tool of status.tools) draft.set(tool.name, tool);
        }
      });
      api.prompt.add((draft) => {
        for (const handle of active.values()) {
          const status = handle.status();
          if (status.kind !== "connected" || status.instructions === undefined) continue;
          draft.set(`mcp:${handle.name}`, {
            text: `## ${handle.name} (MCP)\n\n${status.instructions}`,
            order: 200,
          });
        }
      });
      api.status.add((draft) => {
        const handles = [...active.values()];
        const connected = handles.filter((handle) => handle.status().kind === "connected").length;
        if (connected === handles.length) return;
        draft.set("mcp", { text: `MCP ${String(connected)}/${String(handles.length)}` });
      });
      api.commands.add((draft) => {
        draft.set("mcp", {
          description: "MCP servers and their status; `reconnect` retries failed ones",
          run: (argument) => {
            if (argument.trim() === "reconnect") {
              input.servers.reconnectFailed();
              return "Reconnecting failed MCP servers.";
            }
            if (configured.length === 0) return "No MCP servers configured.";
            return configured
              .map(([name]) => {
                const handle = active.get(name);
                return handle === undefined ? `${name}: off` : describeStatus(handle);
              })
              .join("\n");
          },
        });
      });

      // 5. Start from the stored choices, waiting briefly so a healthy server's tools are
      //    in the first request. A slower one joins the session when it connects.
      await Promise.all(
        configured.map(async ([name, config]) => {
          apply(name, config, isEnabled(await api.storage.get(enabledKey(name)), config));
        }),
      );
      await Promise.race([
        Promise.all(Array.from(active.values(), (handle) => handle.ready())),
        activationDeadline(),
      ]);
      refresh();
    },
  });
}

/** Resolves after the activation budget without holding the process open. */
function activationDeadline(): Promise<void> {
  return new Promise((settle) => {
    const timer = setTimeout(settle, ACTIVATION_WAIT_MS);
    timer.unref();
  });
}

function describeStatus(handle: McpServerHandle): string {
  const status = handle.status();
  switch (status.kind) {
    case "connecting":
      return `${handle.name}: connecting`;
    case "connected":
      return `${handle.name}: ${String(status.tools.length)} ${status.tools.length === 1 ? "tool" : "tools"}`;
    case "failed":
      return `${handle.name}: failed (${firstLine(status.error)})`;
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
