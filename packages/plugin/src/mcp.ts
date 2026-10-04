/**
 * The process owns MCP connections; a session owns the choice of which to use.
 * `McpServers` pools one connection per server config for every session, and
 * `mcpPlugin` turns a session's on/off settings into acquire and release on
 * that pool, offering whatever is connected as tools.
 *
 * A server therefore outlives any one session, and a plugin reload that leaves
 * its config alone never reconnects: the plugin's version is the config's hash.
 */
import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  McpClient,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
} from "@earendil-works/pi-mcp";
import type { ContentBlock, LlmContent } from "@earendil-works/pi-mcp";
import { ToolError, definePlugin, formatSize } from "@nyte-ai/core/plugins";
import type { AgentTool, Disposer, ExecutionEnv } from "@nyte-ai/core/plugins";
import { contentText } from "@nyte-ai/schema";
import type { JsonValue } from "@nyte-ai/schema";
import { Type, Unsafe } from "typebox";
import type { Static, TUnsafe } from "typebox";
import { Value } from "typebox/value";

export const MCP_PLUGIN_ID = "mcp";

const McpExposure = Type.Union([
  Type.Literal("direct"),
  Type.Literal("codemode"),
  Type.Literal("deferred"),
  Type.Literal("hidden"),
]);

const exposureProperties = {
  exposure: Type.Optional(McpExposure),
  toolExposure: Type.Optional(Type.Record(Type.String(), McpExposure)),
  description: Type.Optional(Type.String()),
};

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
      ...exposureProperties,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      url: Type.String({ minLength: 1 }),
      headers: Type.Optional(Type.Record(Type.String(), Type.String())),
      disabled: Type.Optional(Type.Boolean()),
      ...exposureProperties,
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

/** The registry validates arguments against the server's `inputSchema`, an object schema. */
type BridgedTool = AgentTool<
  TUnsafe<Record<string, JsonValue>>,
  {
    server: string;
    tool: string;
    fullOutputPath?: string;
  }
>;

export type McpServerStatus =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "connected";
      readonly tools: readonly BridgedTool[];
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
  client: McpClient | "ended" | undefined;
  readonly ready: Promise<void>;
  settle: () => void;
}

/** One configured server: sessions hold it; its connection is replaced on retry. */
class Slot {
  readonly name: string;
  readonly config: McpServerConfig;
  readonly cwd: string;
  readonly toolOwners: Map<string, string>;
  refs = 0;
  linger: ReturnType<typeof setTimeout> | undefined;
  readonly listeners = new Set<() => void>();
  connection: Connection;

  constructor(name: string, config: McpServerConfig, cwd: string, toolOwners: Map<string, string>) {
    this.name = name;
    this.config = config;
    this.cwd = cwd;
    this.toolOwners = toolOwners;
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
  private readonly toolOwners = new Map<string, string>();

  acquire(name: string, config: McpServerConfig, cwd: string): McpServerHandle {
    const key = connectionKey(name, config, cwd);
    const held = this.slots.get(key) ?? new Slot(name, config, cwd, this.toolOwners);
    this.slots.set(key, held);

    // A config change re-acquires; give a failed server another try then.
    if (held.connection.status.kind === "failed") {
      held.connection = openConnection(held);
      notify(held);
    }
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
      if (slot.connection.status.kind === "failed") {
        slot.connection = openConnection(slot);
        notify(slot);
      }
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
  await Promise.resolve();
  if (connection.client === "ended") return;

  const client = new McpClient({
    name: "nyte",
    version: "0",
    requestTimeoutMs: STARTUP_TIMEOUT_MS,
  });
  const transport =
    "command" in config
      ? new StdioTransport({
          command: config.command,
          args: config.args ?? [],
          env: { ...stdioEnvironment(), ...config.env },
          inheritEnv: false,
          cwd: resolve(cwd, config.cwd ?? "."),
          stderr: "pipe",
          maxStderrBytes: STDERR_TAIL_BYTES,
        })
      : new StreamableHttpTransport({ url: config.url, headers: config.headers });

  const describe = (message: string): string => {
    const stderr = transport instanceof StdioTransport ? transport.stderr.trim() : "";
    return stderr === "" ? message : `${message}\n${stderr}`;
  };

  connection.client = client;
  let initializing = true;
  client.onClose(() => {
    if (connection.client !== client || initializing) return;
    fail(slot, connection, describe("connection closed"));
  });

  try {
    await client.connect(transport);
    if (!Value.Check(McpServerCapabilities, client.serverCapabilities)) {
      throw new Error("Invalid MCP server capabilities");
    }
  } catch (cause) {
    throw new Error(describe(errorMessage(cause)), { cause });
  }
  initializing = false;
  if (connection.client !== client) return;

  const refresh = async (): Promise<void> => {
    if (connection.client !== client) return;
    const tools = await listTools(client, slot);

    if (connection.client !== client) return;
    connection.status = {
      kind: "connected",
      tools,
      instructions: client.instructions?.trim() || undefined,
    };

    if (slot.connection === connection) notify(slot);
  };

  let refreshing = refresh();
  client.onNotification("notifications/tools/list_changed", () => {
    refreshing = refreshing.then(refresh).catch((cause: unknown) => {
      if (connection.client === client) fail(slot, connection, describe(errorMessage(cause)));
    });
  });
  await refreshing;
}

function stdioEnvironment(): Record<string, string> {
  const names =
    process.platform === "win32"
      ? [
          "APPDATA",
          "HOMEDRIVE",
          "HOMEPATH",
          "LOCALAPPDATA",
          "PATH",
          "PROCESSOR_ARCHITECTURE",
          "SYSTEMDRIVE",
          "SYSTEMROOT",
          "TEMP",
          "USERNAME",
          "USERPROFILE",
          "PROGRAMFILES",
        ]
      : ["HOME", "LOGNAME", "PATH", "SHELL", "TERM", "USER"];
  const env: Record<string, string> = {};
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && !value.startsWith("()")) env[name] = value;
  }
  return env;
}

const McpServerCapabilities = Type.Object(
  {
    tools: Type.Optional(
      Type.Object({ listChanged: Type.Optional(Type.Boolean()) }, { additionalProperties: true }),
    ),
  },
  { additionalProperties: true },
);

const McpIcons = Type.Optional(
  Type.Array(
    Type.Object(
      {
        src: Type.String(),
        mimeType: Type.Optional(Type.String()),
        sizes: Type.Optional(Type.Array(Type.String())),
        theme: Type.Optional(Type.Union([Type.Literal("light"), Type.Literal("dark")])),
      },
      { additionalProperties: true },
    ),
  ),
);

const SchemaObject = Type.Object(
  {
    type: Type.Optional(Type.Literal("object")),
    properties: Type.Optional(
      Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
    ),
    required: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: true },
);

const McpTool = Type.Object(
  {
    name: Type.String(),
    title: Type.Optional(Type.String()),
    icons: McpIcons,
    description: Type.Optional(Type.String()),
    inputSchema: SchemaObject,
    outputSchema: Type.Optional(SchemaObject),
    annotations: Type.Optional(
      Type.Object(
        {
          title: Type.Optional(Type.String()),
          readOnlyHint: Type.Optional(Type.Boolean()),
          destructiveHint: Type.Optional(Type.Boolean()),
          idempotentHint: Type.Optional(Type.Boolean()),
          openWorldHint: Type.Optional(Type.Boolean()),
        },
        { additionalProperties: true },
      ),
    ),
    execution: Type.Optional(
      Type.Object(
        {
          taskSupport: Type.Optional(
            Type.Union([
              Type.Literal("forbidden"),
              Type.Literal("optional"),
              Type.Literal("required"),
            ]),
          ),
        },
        { additionalProperties: true },
      ),
    ),
    _meta: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
);

const contentMetadata = {
  annotations: Type.Optional(
    Type.Object(
      {
        audience: Type.Optional(
          Type.Array(Type.Union([Type.Literal("user"), Type.Literal("assistant")])),
        ),
        priority: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        lastModified: Type.Optional(Type.String({ format: "date-time" })),
      },
      { additionalProperties: true },
    ),
  ),
  _meta: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
};

const resourceProperties = {
  uri: Type.String(),
  mimeType: Type.Optional(Type.String()),
  _meta: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
};

const McpContent = Type.Union([
  Type.Object(
    { type: Type.Literal("text"), text: Type.String(), ...contentMetadata },
    { additionalProperties: true },
  ),
  Type.Object(
    {
      type: Type.Literal("image"),
      data: Type.String(),
      mimeType: Type.String(),
      ...contentMetadata,
    },
    { additionalProperties: true },
  ),
  Type.Object(
    {
      type: Type.Literal("audio"),
      data: Type.String(),
      mimeType: Type.String(),
      ...contentMetadata,
    },
    { additionalProperties: true },
  ),
  Type.Object(
    {
      type: Type.Literal("resource"),
      resource: Type.Union([
        Type.Object({ ...resourceProperties, text: Type.String() }, { additionalProperties: true }),
        Type.Object({ ...resourceProperties, blob: Type.String() }, { additionalProperties: true }),
      ]),
      ...contentMetadata,
    },
    { additionalProperties: true },
  ),
  Type.Object(
    {
      type: Type.Literal("resource_link"),
      uri: Type.String(),
      name: Type.String(),
      title: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      mimeType: Type.Optional(Type.String()),
      size: Type.Optional(Type.Number()),
      icons: McpIcons,
      ...contentMetadata,
    },
    { additionalProperties: true },
  ),
]);

const McpCallResult = Type.Object(
  {
    content: Type.Array(McpContent),
    structuredContent: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    isError: Type.Optional(Type.Boolean()),
    _meta: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: true },
);

function parseMcpResult(result: unknown) {
  if (!isJsonObject(result) || !Value.Check(McpCallResult, result)) {
    throw new Error("Invalid MCP tools/call result");
  }
  for (const block of result.content) {
    const data =
      block.type === "image" || block.type === "audio"
        ? block.data
        : block.type === "resource" && "blob" in block.resource
          ? block.resource.blob
          : undefined;
    if (data === undefined) continue;
    try {
      atob(data);
    } catch (cause) {
      throw new Error("Invalid MCP tools/call base64 content", { cause });
    }
  }
  return result;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isJsonValue)
  );
}

async function listTools(client: McpClient, slot: Slot): Promise<BridgedTool[]> {
  if (client.serverCapabilities?.tools === undefined) return [];
  const tools = await client.listTools({ timeoutMs: CATALOG_TIMEOUT_MS });
  const names = new Set<string>();
  for (const tool of tools) {
    if (!isJsonValue(tool) || !Value.Check(McpTool, tool))
      throw new Error("Invalid MCP tools/list entry");
    if (names.has(tool.name)) throw new Error(`Duplicate MCP tool ${tool.name}`);
    names.add(tool.name);
  }
  const plain = tools.map((tool) => bridgedToolName(slot.name, tool.name));
  const current = new Set<string>();
  return tools.map((tool) => {
    const owner = `${slot.name}\0${tool.name}`;
    const name = bridgedToolName(slot.name, tool.name, (candidate) => {
      const existing = slot.toolOwners.get(candidate);
      return (
        (existing !== undefined && existing !== owner) ||
        current.has(candidate) ||
        plain.indexOf(candidate) !== plain.lastIndexOf(candidate)
      );
    });
    slot.toolOwners.set(name, owner);
    current.add(name);
    return bridgeTool(client, slot, tool, name);
  });
}

export function bridgedToolName(
  server: string,
  tool: string,
  isTaken: (name: string) => boolean = () => false,
): string {
  const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");
  if (name.length <= 64 && !isTaken(name)) return name;
  const hash = createHash("sha256").update(`${server}\0${tool}`).digest("hex").slice(0, 8);
  return `${name.slice(0, 64 - hash.length - 1)}_${hash}`;
}

function toolExposure(config: McpServerConfig, name: string): Static<typeof McpExposure> {
  const overrides = config.toolExposure ?? {};
  const exact = Object.hasOwn(overrides, name) ? overrides[name] : undefined;
  if (exact !== undefined) return exact;
  for (const [pattern, exposure] of Object.entries(overrides)) {
    if (!pattern.includes("*")) continue;
    const source = pattern
      .split("*")
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    if (new RegExp(`^${source}$`).test(name)) return exposure;
  }
  return config.exposure ?? "codemode";
}

function bridgeTool(
  client: McpClient,
  slot: Slot,
  tool: Awaited<ReturnType<McpClient["listTools"]>>[number],
  name: string,
): BridgedTool {
  const server = slot.name;
  const description = slot.config.description?.trim();
  const instructions = client.instructions?.trim();
  return {
    name,
    label: `${server}: ${tool.name}`,
    description:
      tool.description?.trim() ||
      tool.title ||
      tool.annotations?.title ||
      `MCP tool ${tool.name} from server ${server}`,
    parameters: Unsafe<Record<string, JsonValue>>({
      ...tool.inputSchema,
      type: tool.inputSchema.type ?? "object",
      properties: tool.inputSchema.properties ?? {},
    }),
    outputSchema: Unsafe<JsonValue>({
      type: "object",
      properties: {
        content: { type: "array", items: { type: "object" } },
        ...(tool.outputSchema === undefined ? {} : { structuredContent: tool.outputSchema }),
        isError: { type: "boolean" },
        _meta: { type: "object" },
      },
      required: ["content"],
    }),
    exposure: toolExposure(slot.config, tool.name),
    namespace: {
      name: `mcp__${server.replace(/[^A-Za-z0-9_]/g, "_")}`,
      ...(description ? { description } : {}),
      ...(instructions ? { instructions } : {}),
    },
    replay: "never",
    async execute(input, call) {
      const result = parseMcpResult(
        await client.callTool(tool.name, input, {
          signal: call.signal,
          timeoutMs: CALL_TIMEOUT_MS,
          onProgress: (progress) => {
            if (
              typeof progress.progress !== "number" ||
              !Number.isFinite(progress.progress) ||
              (progress.total !== undefined &&
                (typeof progress.total !== "number" || !Number.isFinite(progress.total))) ||
              (progress.message !== undefined && typeof progress.message !== "string")
            )
              return;
            const total = progress.total === undefined ? "" : `/${String(progress.total)}`;
            call.update({
              content: [
                {
                  type: "text",
                  text: progress.message ?? `Progress ${String(progress.progress)}${total}`,
                },
              ],
              details: { server, tool: tool.name },
            });
          },
        }),
      );
      const convertedContent =
        result.content.length > 0
          ? (
              await Promise.all(result.content.map((block) => blockToContent(block, call.env)))
            ).flat()
          : toLlmContent(result);
      if (result.isError === true && contentText(convertedContent) === "") {
        convertedContent.push({
          type: "text",
          text: `MCP tool ${server}/${tool.name} returned an error`,
        });
      }
      const { content, fullOutputPath } = await limitMcpContent(convertedContent, call.env);
      const { _meta: _ignored, ...structuredContent } = result;
      const converted = {
        content,
        structuredContent,
        details: { server, tool: tool.name, ...(fullOutputPath ? { fullOutputPath } : {}) },
        title: tool.name,
      };
      if (result.isError === true) throw new ToolError(converted);
      return converted;
    },
  };
}

const MCP_OUTPUT_MAX_BYTES = 20 * 1024;

async function saveOutput(data: string | Uint8Array, extension: string): Promise<string> {
  const path = join(tmpdir(), `nyte-mcp-${randomBytes(8).toString("hex")}${extension}`);
  await writeFile(path, data, { mode: 0o600 });
  return path;
}

async function blockToContent(block: ContentBlock, env: ExecutionEnv): Promise<LlmContent[]> {
  if (block.type === "resource_link") {
    const details = [
      block.mimeType,
      block.size === undefined ? undefined : formatSize(block.size),
    ].filter(Boolean);
    const description = block.description ? `: ${block.description}` : "";
    return [
      {
        type: "text",
        text: `[Resource ${block.uri} "${block.title ?? block.name}"${details.length > 0 ? ` (${details.join(", ")})` : ""}${description}]`,
      },
    ];
  }
  if (
    block.type === "resource" &&
    "blob" in block.resource &&
    !block.resource.mimeType?.startsWith("image/")
  ) {
    const { uri, mimeType, blob } = block.resource;
    const data = Buffer.from(blob, "base64");
    const type = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
    if (
      type &&
      (type.startsWith("text/") ||
        type === "application/json" ||
        type.endsWith("+json") ||
        type.endsWith("+xml"))
    ) {
      return [{ type: "text", text: data.toString("utf8") }];
    }
    const kind = `${mimeType ?? "unknown type"}, ${formatSize(data.length)}`;
    try {
      const uriPath = URL.canParse(uri) ? new URL(uri).pathname : uri;
      const path = await saveOutput(data, /\.[A-Za-z0-9]{1,8}$/.exec(uriPath)?.[0] ?? ".bin");
      const visible = (await env.stat(path).catch(() => undefined))?.kind === "file";

      return [
        {
          type: "text",
          text: `[Binary resource ${uri} (${kind})${visible ? ` saved to ${path}` : ""}]`,
        },
      ];
    } catch (cause) {
      return [
        {
          type: "text",
          text: `[Binary resource ${uri} (${kind}) could not be saved: ${errorMessage(cause)}]`,
        },
      ];
    }
  }
  return toLlmContent({ content: [block] });
}

function truncateMiddle(content: string, maxBytes: number) {
  const buf = Buffer.from(content, "utf-8");
  const totalLines =
    content === "" ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
  if (buf.length <= maxBytes) {
    return { content, truncated: false, totalBytes: buf.length, totalLines };
  }
  const isBoundary = (index: number) => index >= buf.length || (buf[index] & 0xc0) !== 0x80;
  let headEnd = Math.floor(maxBytes / 2);
  while (headEnd > 0 && !isBoundary(headEnd)) headEnd--;
  let tailStart = buf.length - (maxBytes - Math.floor(maxBytes / 2));
  while (tailStart < buf.length && !isBoundary(tailStart)) tailStart++;
  const head = buf.subarray(0, headEnd).toString("utf-8");
  const tail = buf.subarray(tailStart).toString("utf-8");
  const removedChars = Array.from(buf.subarray(headEnd, tailStart).toString("utf-8")).length;
  return {
    content: `${head}…${String(removedChars)} chars truncated…${tail}`,
    truncated: true,
    totalBytes: buf.length,
    totalLines,
  };
}

async function limitMcpContent(
  content: LlmContent[],
  env: ExecutionEnv,
): Promise<{ content: LlmContent[]; fullOutputPath?: string }> {
  const combined = contentText(content);
  const truncation = truncateMiddle(combined, MCP_OUTPUT_MAX_BYTES);
  if (!truncation.truncated) return { content };
  let fullOutputPath: string | undefined;
  let where = "";
  try {
    const saved = await saveOutput(combined, ".txt");

    if ((await env.stat(saved).catch(() => undefined))?.kind === "file") {
      fullOutputPath = saved;
      where = `\n\n[Full output: ${saved} (read it with offset/limit)]`;
    }
  } catch (cause) {
    where = `\n\n[Could not save the full output: ${errorMessage(cause)}]`;
  }
  const tokens = Math.ceil(truncation.totalBytes / 4);
  const text = `Warning: truncated output (original token count: ${String(tokens)})\nTotal output lines: ${String(truncation.totalLines)}\n\n${truncation.content}${where}`;
  return {
    content: [{ type: "text", text }, ...content.filter((block) => block.type === "image")],
    ...(fullOutputPath ? { fullOutputPath } : {}),
  };
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

/** The manifest's `disabled` is only the choice a session starts from. */
function defaultChoice(config: McpServerConfig): "on" | "off" {
  return config.disabled === true ? "off" : "on";
}

export function mcpPlugin(input: { readonly servers: McpServers; readonly config: McpConfig }) {
  return definePlugin({
    id: MCP_PLUGIN_ID,
    async session(api) {
      const configured = Object.entries(input.config);

      // 1. Each server is a setting; the manifest's `disabled` is its default.
      const settings = configured.map(([name, config]) => ({
        name,
        config,
        setting: api.settings.add(mcpServerSettingId(name), {
          label: `MCP · ${name}`,
          default: defaultChoice(config),
          choices: [
            { id: "on", label: "on", description: "Connected; its tools are offered" },
            { id: "off", label: "off", description: "Disconnected; its tools are hidden" },
          ],
        }),
      }));

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

        api.refresh();
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

      // 3. A choice changed on any host takes effect once this session is between tool cycles.
      for (const { name, config, setting } of settings) {
        setting.subscribe((choice) => {
          api.defer(() => {
            apply(name, config, choice === "on");
            refresh();
          });
        });
      }
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

          if (
            status.kind !== "connected" ||
            status.instructions === undefined ||
            status.tools.every((tool) => tool.exposure === "hidden")
          )
            continue;
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
          selection: "run",
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
        settings.map(async ({ name, config, setting }) => {
          apply(name, config, (await setting.get()) === "on");
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
