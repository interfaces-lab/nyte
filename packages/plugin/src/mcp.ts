/**
 * MCP servers as a host-owned service and the plugin that projects them.
 *
 * `McpServers` holds one connection per distinct server configuration for the
 * whole process; sessions acquire and release it, so a server outlives any one
 * session and a plugin reload that leaves its config alone never reconnects.
 * `mcpPlugin` is what a session activates: it acquires the servers named in
 * the manifest, contributes their tools and instructions, and warns when a
 * server fails. Its version is the config's hash, so it reloads (and the pool
 * reconnects) only when the config changes.
 *
 * Modeled on opencode v2 `packages/core/src/mcp` and `tool/mcp.ts`, without
 * OAuth, resources, or prompts: connect, list tools, call tools.
 */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";
import { definePlugin } from "@nyte-ai/core/plugins";
import type { AgentTool, Disposer } from "@nyte-ai/core/plugins";
import type { ImageContent, JsonValue, TextContent } from "@nyte-ai/schema";
import { Type, Unsafe } from "typebox";
import type { Static } from "typebox";

export const MCP_PLUGIN_ID = "mcp";

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
  subscribe(listener: () => void): Disposer;
  release(): void;
}

interface Connection {
  status: McpServerStatus;
  client: Client | undefined;
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
    return {
      name,
      status: () => held.connection.status,
      ready: () => held.connection.ready,
      subscribe: (listener) => {
        held.listeners.add(listener);
        return () => {
          held.listeners.delete(listener);
        };
      },
      release: () => {
        if (released) return;
        released = true;
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

async function closeConnection(connection: Connection): Promise<void> {
  const { client } = connection;
  connection.client = undefined;
  await client?.close().catch(() => undefined);
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
    promptSnippet: `${name}: ${firstLine(tool.description ?? `MCP tool ${tool.name} on ${server}`)}`,
    async execute(_toolCallId, params, signal) {
      // The registry validated `params` against `inputSchema`, an object schema.
      if (!isRecord(params)) throw new Error(`${name} expects an object`);
      // The client's return type is a union with the legacy shape; parse the modern one.
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

export function mcpPlugin(input: { readonly servers: McpServers; readonly config: McpConfig }) {
  return definePlugin({
    id: MCP_PLUGIN_ID,
    async session(api) {
      const handles = Object.entries(input.config)
        .filter(([, config]) => config.disabled !== true)
        .map(([name, config]) => input.servers.acquire(name, config, api.env.cwd));
      api.signal.addEventListener("abort", () => {
        for (const handle of handles) handle.release();
      });
      const reported = new Map<string, string>();
      const report = (): void => {
        for (const handle of handles) {
          const status = handle.status();
          if (status.kind !== "failed" || reported.get(handle.name) === status.error) continue;
          reported.set(handle.name, status.error);
          api.diagnostics.warn(`MCP server ${handle.name}: ${status.error}`);
        }
      };
      api.tools.add((draft) => {
        for (const handle of handles) {
          const status = handle.status();
          if (status.kind !== "connected") continue;
          for (const tool of status.tools) draft.set(tool.name, tool);
        }
      });
      api.prompt.add((draft) => {
        for (const handle of handles) {
          const status = handle.status();
          if (status.kind !== "connected" || status.instructions === undefined) continue;
          draft.set(`mcp:${handle.name}`, {
            text: `## ${handle.name} (MCP)\n\n${status.instructions}`,
            order: 200,
          });
        }
      });
      api.commands.add((draft) => {
        draft.set("mcp", {
          description: "MCP servers and their status; `reconnect` retries failed ones",
          run: (argument) => {
            if (argument.trim() === "reconnect") {
              input.servers.reconnectFailed();
              return "Reconnecting failed MCP servers.";
            }
            if (handles.length === 0) return "No MCP servers configured.";
            return handles.map((handle) => describeStatus(handle)).join("\n");
          },
        });
      });
      for (const handle of handles) {
        api.signal.addEventListener(
          "abort",
          handle.subscribe(() => {
            report();
            api.tools.rebuild();
          }),
        );
      }
      // A step that starts after activation sees every server that will answer.
      await Promise.all(handles.map((handle) => handle.ready()));
      report();
    },
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
