import { createHash } from "node:crypto";
import type { CallToolResult, McpClient, Tool } from "@earendil-works/pi-mcp";
import type { ExecutionEnv, ToolDefinition } from "@nyte-ai/core";
import { isJson } from "@nyte-ai/schema";
import type { Json, McpExposure, Schema, ToolContent, ValidationIssue } from "@nyte-ai/schema";
import { Errors, Meta } from "typebox/schema";
import type { McpServerEntry } from "./config.ts";

const NAME_LIMIT = 64;

const DRAFT_2020_12 = Meta["https://json-schema.org/draft/2020-12/schema"];

/** The exposure `entry` gives `tool`: an exact `toolExposure` key, else the first matching pattern, else the server's. */
export function toolExposure(entry: McpServerEntry, tool: string): McpExposure {
  const exact = entry.toolExposure.find(([pattern]) => pattern === tool);

  if (exact !== undefined) return exact[1];
  const matched = entry.toolExposure.find(([pattern]) => globMatches(pattern, tool));

  return matched?.[1] ?? entry.exposure;
}

/** A server's listed tools that sessions get, and why each of the others is left out. */
export type CheckedTools = {
  readonly usable: readonly Tool[];
  readonly issues: readonly ValidationIssue[];
};

/**
 * Splits a server's listed tools into those whose input schema is JSON Schema
 * for an object, which providers accept, and an issue for each of the rest.
 * A tool with a bad schema would fail every request that declares it, so no
 * session gets it.
 */
export function checkToolSchemas(server: string, tools: readonly Tool[]): CheckedTools {
  const usable: Tool[] = [];
  const issues: ValidationIssue[] = [];

  for (const tool of tools) {
    const problem = findSchemaProblem(tool.inputSchema);

    if (problem === null) {
      usable.push(tool);

      continue;
    }

    issues.push({
      severity: "error",
      path: ["mcpServers", server, "tools", tool.name, "inputSchema"],
      message: `${server} lists ${tool.name} with an input schema that is not valid JSON Schema (${problem}), so sessions do not get the tool.`,
    });
  }

  return { usable, issues };
}

function findSchemaProblem(schema: Tool["inputSchema"]): string | null {
  if (schema["type"] !== "object") return 'its type is not "object"';
  const [valid, errors] = Errors(Meta, DRAFT_2020_12, schema);

  if (valid) return null;
  const first = new Map<string, string>();

  for (const error of errors)
    if (!first.has(error.instancePath))
      first.set(error.instancePath, `${error.instancePath || "/"} ${error.message}`);

  return [...first.values()].slice(0, 3).join("; ");
}

/** Turns a server's listed tools into session tools named `mcp__<server>__<tool>`. */
export function bridgeTools(
  entry: McpServerEntry,
  tools: readonly Tool[],
  client: McpClient,
): ToolDefinition[] {
  const names = tools.map((tool) => toolName(entry.name, tool.name));
  const counts = Map.groupBy(names, (name) => name);

  return tools.map((tool, index) => {
    const name = names[index];
    const unique = (counts.get(name)?.length ?? 0) > 1 ? hashed(name, tool.name) : name;

    return bridge(entry, tool, client, unique);
  });
}

function toolName(server: string, tool: string): string {
  const name = `mcp__${server}__${tool}`.replace(/[^A-Za-z0-9_]/g, "_");

  return name.length > NAME_LIMIT ? hashed(name, tool) : name;
}

function hashed(name: string, tool: string): string {
  const suffix = createHash("sha256").update(tool).digest("hex").slice(0, 8);

  return `${name.slice(0, NAME_LIMIT - suffix.length - 1)}_${suffix}`;
}

function globMatches(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return false;

  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${source}$`).test(value);
}

function bridge(
  entry: McpServerEntry,
  tool: Tool,
  client: McpClient,
  name: string,
): ToolDefinition {
  const output = tool.outputSchema;

  return {
    name,
    namespace: `mcp/${entry.name}`,
    description: tool.description ?? tool.title ?? tool.name,
    parameters: passthrough(tool.inputSchema),
    ...(output === undefined ? {} : { output: passthrough(output) }),
    exposure: toolExposure(entry, tool.name),
    class: () => ({ kind: "custom", label: `${entry.name}: ${tool.title ?? tool.name}` }),
    effects: tool.annotations?.readOnlyHint === true ? "none" : "workspace",
    replay:
      tool.annotations?.readOnlyHint === true || tool.annotations?.idempotentHint === true
        ? "safe"
        : "never",
    async execute(args, invocation) {
      const result = await client.callTool(tool.name, isObject(args) ? args : {}, {
        signal: invocation.signal,
        timeoutMs: entry.timeoutMs,
        onProgress: () => undefined,
      });

      const content = await readToolContent(result, invocation.env);

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

async function readToolContent(result: CallToolResult, env: ExecutionEnv): Promise<ToolContent[]> {
  const content: ToolContent[] = [];

  for (const block of result.content) {
    if (block.type === "text") content.push({ kind: "text", text: block.text });
    else if (block.type === "image")
      content.push({
        kind: "file",
        blob: await env.files.upload(once(Uint8Array.fromBase64(block.data))),
        mime: block.mimeType,
      });
    else content.push({ kind: "text", text: JSON.stringify(block) });
  }

  return content;
}

function passthrough(json: Record<string, unknown>): Schema<Json> {
  return {
    "~standard": {
      version: 1,
      vendor: "mcp",
      validate: (value) =>
        isObject(value) ? { value } : { issues: [{ message: "Expected a JSON object." }] },
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

function isObject(value: unknown): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && isJson(value);
}

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}
