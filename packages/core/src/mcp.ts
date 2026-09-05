import {
  Client,
  StreamableHTTPClientTransport,
  type CallToolResult,
  type DiscoverResult,
  type FetchLike,
  type RequestOptions,
  type StreamableHTTPClientTransportOptions,
  type Tool,
} from "@modelcontextprotocol/client";
import type { ImageContent, JsonValue, TextContent } from "@uji-ai/schema";
import { Unsafe } from "typebox";
import type { HarnessTool } from "./harness/agent-harness.ts";
import { toJsonValue } from "./harness/session/types.ts";
import type { AgentTool, AgentToolResult } from "./types.ts";
import { ToolError, toolResultContent } from "./utils/tool-result.ts";

export const MCP_PROTOCOL_VERSION = "2026-07-28";

const CLIENT_INFO = { name: "uji", version: "0.0.0" };
const MAX_TOOL_NAME_LENGTH = 64;
const VALID_TOOL_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/u;

type McpAuthProvider = NonNullable<StreamableHTTPClientTransportOptions["authProvider"]>;

/** Trusted host configuration for one remote Streamable HTTP MCP server. */
export interface McpHttpServer {
  readonly id: string;
  readonly url: URL;
  readonly headers?: Readonly<Record<string, string>>;
  readonly authProvider?: McpAuthProvider;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

export interface McpToolDetails {
  readonly serverId: string;
  readonly remoteToolName: string;
  readonly structuredContent?: JsonValue;
}

type ConnectionProof =
  | { readonly kind: "probe" }
  | { readonly kind: "discovered"; readonly discover: DiscoverResult };

function stableHash(value: string): string {
  let hash = 0x81_1c_9d_c5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01_00_01_93);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** A deterministic provider-safe name for a remote MCP tool. */
export function mcpToolName(input: {
  readonly serverId: string;
  readonly remoteToolName: string;
}): string {
  if (input.serverId === "") throw new Error("MCP server id must not be empty");
  if (input.remoteToolName === "") throw new Error("MCP tool name must not be empty");
  const raw = `mcp_${String(input.serverId.length)}_${input.serverId}_${input.remoteToolName}`;
  if (raw.length <= MAX_TOOL_NAME_LENGTH && VALID_TOOL_NAME.test(raw)) return raw;

  const sanitized = raw.replaceAll(/[^A-Za-z0-9_-]/gu, "_");
  const suffix = stableHash(`${input.serverId}\u0000${input.remoteToolName}`);
  const readableLength = MAX_TOOL_NAME_LENGTH - suffix.length - 1;
  const readable = sanitized.slice(0, readableLength).replaceAll(/_+$/gu, "");
  return `${readable}_${suffix}`;
}

function requestOptions(server: McpHttpServer, signal: AbortSignal | undefined): RequestOptions {
  if (
    server.timeoutMs !== undefined &&
    (!Number.isFinite(server.timeoutMs) || server.timeoutMs <= 0)
  ) {
    throw new Error("MCP timeout must be a positive finite number of milliseconds");
  }
  return {
    ...(signal === undefined ? {} : { signal }),
    ...(server.timeoutMs === undefined ? {} : { timeout: server.timeoutMs }),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function closeClient(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // A completed stateless request has no session state that needs recovery.
  }
}

async function connectClient(
  server: McpHttpServer,
  proof: ConnectionProof,
  signal: AbortSignal | undefined,
): Promise<Client> {
  const client = new Client(CLIENT_INFO, {
    supportedProtocolVersions: [MCP_PROTOCOL_VERSION],
    versionNegotiation: { mode: { pin: MCP_PROTOCOL_VERSION } },
    inputRequired: { autoFulfill: false },
  });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    ...(server.headers === undefined ? {} : { requestInit: { headers: server.headers } }),
    ...(server.authProvider === undefined ? {} : { authProvider: server.authProvider }),
    ...(server.fetch === undefined ? {} : { fetch: server.fetch }),
  });
  try {
    await client.connect(transport, {
      ...requestOptions(server, signal),
      ...(proof.kind === "probe" ? {} : { prior: { kind: "modern", discover: proof.discover } }),
    });
    if (
      client.getProtocolEra() !== "modern" ||
      client.getNegotiatedProtocolVersion() !== MCP_PROTOCOL_VERSION
    ) {
      throw new Error(`server did not negotiate ${MCP_PROTOCOL_VERSION}`);
    }
    return client;
  } catch (error) {
    await closeClient(client);
    throw new Error(`MCP server "${server.id}" connection failed: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

function convertContentPart(
  part: CallToolResult["content"][number],
): (TextContent | ImageContent)[] {
  switch (part.type) {
    case "text":
      return [{ type: "text", text: part.text }];
    case "image":
      return [{ type: "image", data: part.data, mimeType: part.mimeType }];
    case "audio":
      return toolResultContent(`Audio result (${part.mimeType}) cannot be attached by Uji.`);
    case "resource_link":
      return toolResultContent(`${part.title ?? part.name}: ${part.uri}`);
    case "resource": {
      const resource = part.resource;
      if ("text" in resource) return toolResultContent(resource.text);
      if (resource.mimeType?.startsWith("image/") === true) {
        return [{ type: "image", data: resource.blob, mimeType: resource.mimeType }];
      }
      const description =
        resource.mimeType === undefined ? resource.uri : `${resource.uri} (${resource.mimeType})`;
      return toolResultContent(`Binary resource ${description} cannot be attached by Uji.`);
    }
    default: {
      const _exhaustive: never = part;
      return _exhaustive;
    }
  }
}

function convertToolResult(
  serverId: string,
  remoteToolName: string,
  result: CallToolResult,
): AgentToolResult<McpToolDetails> {
  const structured =
    result.structuredContent === undefined ? undefined : toJsonValue(result.structuredContent);
  const content = result.content.flatMap(convertContentPart);
  if (content.length === 0 && structured !== undefined) {
    content.push(...toolResultContent(JSON.stringify(structured)));
  }
  if (content.length === 0 && result.isError === true) {
    content.push(...toolResultContent("MCP tool returned an error"));
  }
  return {
    content,
    details: {
      serverId,
      remoteToolName,
      ...(structured === undefined ? {} : { structuredContent: structured }),
    },
  };
}

async function callWithClient(
  client: Client,
  server: McpHttpServer,
  definition: Tool,
  args: Readonly<Record<string, JsonValue>>,
  signal: AbortSignal | undefined,
): Promise<AgentToolResult<McpToolDetails>> {
  let remoteResult: CallToolResult;
  try {
    remoteResult = await client.callTool(
      { name: definition.name, arguments: args },
      { ...requestOptions(server, signal), toolDefinition: definition },
    );
  } catch (error) {
    throw new Error(
      `MCP server "${server.id}" tool "${definition.name}" failed: ${errorMessage(error)}`,
      { cause: error },
    );
  }
  const result = convertToolResult(server.id, definition.name, remoteResult);
  if (remoteResult.isError === true) throw new ToolError(result);
  return result;
}

function harnessTool(
  server: McpHttpServer,
  definition: Tool,
  discover: DiscoverResult,
): HarnessTool {
  const parameters = Unsafe<Record<string, JsonValue>>(definition.inputSchema);
  const tool: AgentTool<typeof parameters, McpToolDetails> = {
    name: mcpToolName({ serverId: server.id, remoteToolName: definition.name }),
    label: definition.title ?? definition.annotations?.title ?? definition.name,
    description: definition.description ?? definition.title ?? definition.name,
    parameters,
    replay: "never",
    execute: async (_toolCallId, args, signal) => {
      const client = await connectClient(server, { kind: "discovered", discover }, signal);
      try {
        return await callWithClient(client, server, definition, args, signal);
      } finally {
        await closeClient(client);
      }
    },
  };
  return tool;
}

/** Discover one trusted remote server's tools before plugin activation. */
export async function discoverMcpTools(input: {
  readonly server: McpHttpServer;
  readonly signal?: AbortSignal;
}): Promise<readonly HarnessTool[]> {
  const client = await connectClient(input.server, { kind: "probe" }, input.signal);
  try {
    const listed = await client.listTools(undefined, requestOptions(input.server, input.signal));
    const discover = client.getDiscoverResult();
    if (discover === undefined) throw new Error("modern MCP discovery result is missing");
    const tools = listed.tools.map((definition) => harnessTool(input.server, definition, discover));
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name)) {
        throw new Error(`MCP server "${input.server.id}" has conflicting tool names: ${tool.name}`);
      }
      names.add(tool.name);
    }
    return tools;
  } catch (error) {
    throw new Error(`MCP server "${input.server.id}" discovery failed: ${errorMessage(error)}`, {
      cause: error,
    });
  } finally {
    await closeClient(client);
  }
}

/** Discover and call one remote tool without registering the server's catalog. */
export async function callMcpTool(input: {
  readonly server: McpHttpServer;
  readonly name: string;
  readonly arguments: Readonly<Record<string, JsonValue>>;
  readonly signal?: AbortSignal;
}): Promise<AgentToolResult<McpToolDetails>> {
  const client = await connectClient(input.server, { kind: "probe" }, input.signal);
  try {
    const listed = await client.listTools(undefined, requestOptions(input.server, input.signal));
    const definition = listed.tools.find((tool) => tool.name === input.name);
    if (definition === undefined) {
      throw new Error(`MCP server "${input.server.id}" does not provide tool "${input.name}"`);
    }
    return await callWithClient(client, input.server, definition, input.arguments, input.signal);
  } finally {
    await closeClient(client);
  }
}
