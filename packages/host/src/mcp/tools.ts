import { createHash } from "node:crypto";
import { McpClient } from "@earendil-works/pi-mcp";
import type {
  CallToolResult,
  McpRequestOptions,
  ProgressNotification,
  Tool,
} from "@earendil-works/pi-mcp";
import { attachFile, followedTrace, startSpan, traceparent } from "@nyte-ai/core";
import type { ExecutionEnv, ToolDefinition, ToolNamespace } from "@nyte-ai/core";
import { isJson, isJsonObject } from "@nyte-ai/schema";
import type {
  Json,
  McpExposure,
  Schema,
  ToolContent,
  ToolProgress,
  ValidationIssue,
} from "@nyte-ai/schema";
import { Errors, Meta } from "typebox/schema";
import type { McpServerEntry } from "./config.ts";

type JsonObject = { readonly [key: string]: Json };

const NAME_LIMIT = 64;

/** The most result text a session stores and the model sees; the rest is kept as an attachment. */
const RESULT_CHARS = 32_000;

/** How much of a clipped result's head is kept; the tail keeps the rest of `RESULT_CHARS`. */
const HEAD_CHARS = 8_000;

/** The longest a call may run in all, however often its progress resets the per-request timeout. */
const CALL_LIMIT_MS = 10 * 60_000;

const DRAFT_2020_12 = Meta["https://json-schema.org/draft/2020-12/schema"];

/** JSON Schema draft-04 through 2020-12, by `$schema` URI without its scheme or empty fragment; draft-03's boolean `required` is no provider's. */
const DRAFTS = new Map(
  Object.entries(Meta)
    .filter(([uri]) => !uri.includes("draft-03"))
    .map(([uri, meta]) => [draftKey(uri), meta] as const),
);

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

/**
 * Checks `schema` against the draft its `$schema` names, or when it names none typebox knows,
 * against every draft: servers emit draft-07 tuples and draft-04 boolean bounds without saying
 * so. Errors are reported against the named draft, else 2020-12.
 */
function findSchemaProblem(schema: Tool["inputSchema"]): string | null {
  if (schema["type"] !== "object") return 'its type is not "object"';
  const declared = schema["$schema"];
  const named = typeof declared === "string" ? DRAFTS.get(draftKey(declared)) : undefined;
  const drafts = named === undefined ? [...DRAFTS.values()] : [named];

  if (drafts.some((meta) => Errors(Meta, meta, schema)[0])) return null;
  const [, errors] = Errors(Meta, named ?? DRAFT_2020_12, schema);
  const first = new Map<string, string>();

  for (const error of errors)
    if (!first.has(error.instancePath))
      first.set(error.instancePath, `${error.instancePath || "/"} ${error.message}`);

  return [...first.values()].slice(0, 3).join("; ");
}

function draftKey(uri: string): string {
  return uri.replace(/^https?:\/\//, "").replace(/#$/, "");
}

/** Calls one of the server's tools over its live connection, its `traceparent` carried to the server; throws when the server is not connected. */
export type McpCall = (
  name: string,
  args: Record<string, unknown>,
  options: McpRequestOptions & { readonly traceparent?: string },
) => Promise<CallToolResult>;

/** An `McpClient` whose requests carry a `traceparent` given in their options to the server in `params._meta`, where MCP's trace-context convention puts it. */
export class TracingMcpClient extends McpClient {
  override request<Result = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: McpRequestOptions,
  ): Promise<Result> {
    const traceparent =
      options !== undefined && "traceparent" in options && typeof options.traceparent === "string"
        ? options.traceparent
        : null;

    return super.request(
      method,
      traceparent === null || params?._meta !== undefined
        ? params
        : { ...params, _meta: { traceparent } },
      options,
    );
  }
}

/**
 * Turns a server's listed tools into session tools named
 * `mcp__<server>__<tool>`, in the namespace `mcp__<server>` (alias
 * `<server>`) that carries the server's description and instructions.
 */
export function bridgeTools(
  entry: McpServerEntry,
  listed: { readonly tools: readonly Tool[]; readonly instructions: string | null },
  call: McpCall,
): ToolDefinition[] {
  const names = listed.tools.map((tool) => toolName(entry.name, tool.name));
  const counts = Map.groupBy(names, (name) => name);
  const description = entry.description?.trim() ?? "";
  const instructions = listed.instructions?.trim() ?? "";

  const namespace: ToolNamespace = {
    name: `mcp__${entry.name}`.replace(/[^A-Za-z0-9_]/g, "_"),
    aliases: [entry.name],
    ...(description === "" ? {} : { description }),
    ...(instructions === "" ? {} : { instructions }),
  };

  return listed.tools.map((tool, index) => {
    const name = names[index];
    const unique = (counts.get(name)?.length ?? 0) > 1 ? hashed(name, tool.name) : name;

    return bridge(entry, tool, call, unique, namespace);
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

/** One listed tool as a session tool. Codemode's go unlisted like `deferred` ones; the session's prompt names their server instead. */
function bridge(
  entry: McpServerEntry,
  tool: Tool,
  call: McpCall,
  name: string,
  namespace: ToolNamespace,
): ToolDefinition<JsonObject> {
  const output = tool.outputSchema;
  const exposure = toolExposure(entry, tool.name);

  const definition: ToolDefinition<JsonObject> = {
    name,
    namespace,
    description: tool.description ?? tool.title ?? tool.name,
    parameters: passthrough(tool.inputSchema),
    exposure: exposure === "code" ? "deferred" : exposure,
    class: () => ({ kind: "custom", label: `${entry.name}: ${tool.title ?? tool.name}` }),
    effects: tool.annotations?.readOnlyHint === true ? "none" : "workspace",
    replay:
      tool.annotations?.readOnlyHint === true || tool.annotations?.idempotentHint === true
        ? "safe"
        : "never",
    async execute(args, invocation) {
      const limitMs = Math.max(entry.timeoutMs, CALL_LIMIT_MS);
      const limit = AbortSignal.timeout(limitMs);

      let result: CallToolResult;

      const trace = followedTrace(invocation.session.id);

      const ended = startSpan("mcp.call", trace, {
        session: invocation.session.id,
        server: entry.name,
        tool: tool.name,
      });

      try {
        result = await call(tool.name, args, {
          signal: AbortSignal.any([invocation.signal, limit]),
          timeoutMs: entry.timeoutMs,
          onProgress: (update) => invocation.progress(toolProgress(update)),
          traceparent: trace === null ? undefined : traceparent(trace),
        });
      } catch (error) {
        ended({ failed: true });

        if (!limit.aborted || invocation.signal.aborted) throw error;

        throw new Error(
          `${tool.name} was still running after ${limitMs / 60_000} minutes, so it was cancelled.`,
          { cause: error },
        );
      }

      ended({ failed: result.isError === true });

      if (result.isError === true) {
        const text = resultText(result);

        throw new Error(
          text.length > RESULT_CHARS ? clip(text, "") : text || `${tool.name} failed.`,
        );
      }

      const content = await readToolContent(result, invocation.env, tool.name);

      const structured = result.structuredContent;

      if (
        output === undefined ||
        !isJson(structured) ||
        JSON.stringify(structured).length > RESULT_CHARS
      )
        return { content };

      return { content, output: structured };
    },
  };

  return output === undefined ? definition : { ...definition, output: passthrough(output) };
}

function toolProgress(update: ProgressNotification): ToolProgress {
  const step =
    update.total === undefined ? `${update.progress}` : `${update.progress} of ${update.total}`;

  const text = update.message ?? step;

  return update.total === undefined || update.total <= 0
    ? { text }
    : { text, fraction: Math.min(1, update.progress / update.total) };
}

/**
 * The result's blocks as tool content. Text past `RESULT_CHARS` in all is
 * clipped (`clip`) and the whole text is attached once as a file.
 */
async function readToolContent(
  result: CallToolResult,
  env: ExecutionEnv,
  tool: string,
): Promise<readonly ToolContent[]> {
  const content = await Promise.all(
    result.content.map(async (block): Promise<ToolContent> =>
      block.type === "image"
        ? attachFile(env.files, once(Uint8Array.fromBase64(block.data)), { mime: block.mimeType })
        : { kind: "text", text: block.type === "text" ? block.text : JSON.stringify(block) },
    ),
  );

  const text = resultText(result);

  if (text.length <= RESULT_CHARS) return content;
  const name = `${tool}.txt`;

  const whole = await attachFile(env.files, once(new TextEncoder().encode(text)), {
    mime: "text/plain",
    name,
  });

  return [
    {
      kind: "text",
      text: clip(text, whole.kind === "file" ? `; the whole result is attached as ${name}` : ""),
    },
    whole,
    ...content.filter((_, index) => result.content[index]?.type === "image"),
  ];
}

/** The result's text blocks, and its other blocks but images as JSON, one per line. */
function resultText(result: CallToolResult): string {
  return result.content
    .flatMap((block) =>
      block.type === "image" ? [] : [block.type === "text" ? block.text : JSON.stringify(block)],
    )
    .join("\n");
}

/** `text`'s head and its longer tail, which is where logs put the failure, around a marker ending in `note`. */
function clip(text: string, note: string): string {
  const elided = (text.length - RESULT_CHARS).toLocaleString("en-US");

  return `${text.slice(0, HEAD_CHARS)}\n\n[${elided} characters cut from the middle${note}.]\n\n${text.slice(HEAD_CHARS - RESULT_CHARS)}`;
}

function passthrough(json: Tool["inputSchema"]): Schema<JsonObject> {
  return {
    "~standard": {
      version: 1,
      vendor: "mcp",
      validate: (value) =>
        isJson(value) && isJsonObject(value)
          ? { value }
          : { issues: [{ message: "Expected a JSON object." }] },
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

async function* once(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  yield bytes;
}
