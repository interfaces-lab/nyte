import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodemodeSandbox } from "@earendil-works/pi-codemode";
import type {
  CodemodeResult,
  CodemodeSandboxOptions,
  CodemodeStoreWrites,
  CodemodeTool,
} from "@earendil-works/pi-codemode";
import { renderToolSample } from "@earendil-works/pi-codemode/declarations";
import { parseCodemodeSource } from "@earendil-works/pi-codemode/source";
import { ToolError } from "@nyte-ai/core/plugins";
import type { AgentTool, AgentToolResult, ToolCall, ToolRun } from "@nyte-ai/core/plugins";
import { contentText } from "@nyte-ai/schema";
import type { ImageContent, Message, TextContent } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { toCodemodeDeclaration } from "./codemode-declarations.ts";
import { createDiscoveryGlobals } from "./codemode-search.ts";

export interface CodemodeNestedCall {
  id: string;
  name: string;
  args: string;
  status: "running" | "ok" | "error" | "cancelled";
  durationMs?: number;
  error?: string;
}

export interface CodemodeToolDetails {
  calls: CodemodeNestedCall[];
  fullOutputPath?: string;
  storeWrites?: CodemodeStoreWrites;
}

const ARGS_PREVIEW_CHARS = 200;
const ERROR_PREVIEW_CHARS = 500;
const CODEMODE_MEMORY_LIMIT_BYTES = 256 * 1024 * 1024;

const storeDetailsSchema = Type.Object({
  storeWrites: Type.Object({
    set: Type.Record(Type.String(), Type.Unknown()),
    delete: Type.Array(Type.String()),
  }),
});

export function readCodemodeStore(messages: readonly Message[]): Record<string, unknown> {
  const store = new Map<string, unknown>();
  for (const message of messages) {
    if (message.role !== "toolResult" || message.toolName !== "codemode" || message.isError)
      continue;
    const details: unknown = message.details;
    if (!Value.Check(storeDetailsSchema, details)) continue;
    for (const key of details.storeWrites.delete) store.delete(key);
    for (const [key, value] of Object.entries(details.storeWrites.set)) store.set(key, value);
  }
  return Object.fromEntries(store);
}

function truncateText(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars - 3)}...` : text;
}

function previewArgs(args: unknown): string {
  if (args === undefined) return "";
  try {
    return truncateText(JSON.stringify(args) ?? "", ARGS_PREVIEW_CHARS);
  } catch {
    return "";
  }
}

const DEFAULT_MAX_OUTPUT_TOKENS = 10_000;
const CHARS_PER_TOKEN = 4;

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value) ?? String(value);
}

function formatCallSummary(calls: readonly CodemodeNestedCall[]): string {
  if (calls.length === 0) return "No tool calls were made.";
  return `Tool calls made before the failure (they are not undone): ${calls.map((call) => `${call.name} (${call.status})`).join(", ")}`;
}

function formatError(
  result: Extract<CodemodeResult, { ok: false }>,
  calls: readonly CodemodeNestedCall[],
): string {
  const { error } = result;
  const head =
    error.kind === "script"
      ? (error.stack ?? `${error.name ?? "Error"}: ${error.message}`)
      : error.kind === "timeout"
        ? `Script timed out: ${error.message}`
        : error.kind === "aborted"
          ? `Script aborted: ${error.message}`
          : `Script sandbox failed: ${error.message}`;
  return `${head}\n\n${formatCallSummary(calls)}`;
}

async function spillOutput(text: string): Promise<{ path: string } | { error: string }> {
  const path = join(tmpdir(), `nyte-codemode-${randomBytes(8).toString("hex")}.txt`);
  try {
    await writeFile(path, text, { mode: 0o600 });
    return { path };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

async function truncateOutput(
  items: (TextContent | ImageContent)[],
  maxTokens: number,
): Promise<{ items: (TextContent | ImageContent)[]; fullOutputPath?: string }> {
  const texts = items
    .filter((item): item is TextContent => item.type === "text")
    .map((item) => item.text);
  const combined = texts.join("\n");
  const budget = maxTokens * CHARS_PER_TOKEN;
  if (texts.length === 0 || combined.length <= budget) return { items };
  const headChars = Math.floor(budget / 2);
  const tailChars = budget - headChars;
  const removed = combined.length - headChars - tailChars;
  const head = combined.slice(0, headChars);
  const tail = tailChars > 0 ? combined.slice(-tailChars) : "";
  let text = `Warning: truncated output (original token count: ${Math.ceil(combined.length / CHARS_PER_TOKEN)})\nTotal output lines: ${combined.split("\n").length}\n\n${head}…${Math.ceil(removed / CHARS_PER_TOKEN)} tokens truncated…${tail}`;
  const spilled = await spillOutput(combined);
  text +=
    "path" in spilled
      ? `\n\n[Full output: ${spilled.path} (read with offset/limit)]`
      : `\n\n[Could not save the full output: ${spilled.error}]`;
  return {
    items: [{ type: "text", text }, ...items.filter((item) => item.type === "image")],
    ...("path" in spilled ? { fullOutputPath: spilled.path } : {}),
  };
}

function toScriptValue(
  tool: AgentTool,
  outcome: Awaited<ReturnType<ToolRun["tools"]["execute"]>>,
): unknown {
  const { result } = outcome;
  if (tool.outputSchema && result.structuredContent !== undefined) return result.structuredContent;
  const text = contentText(result.content ?? []);
  if (outcome.kind === "error") throw new Error(text || `Tool "${tool.name}" failed`);
  return text;
}

/** Run a script. Outside a run it has no tools and an empty store; inside one it has the run's. */
export async function executeCodemode(input: {
  code: string;
  call: ToolCall<CodemodeToolDetails>;
  runtime?: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm">;
}): Promise<AgentToolResult<CodemodeToolDetails>> {
  const startedAt = performance.now();
  const { code, options: sourceOptions } = parseCodemodeSource(input.code);
  const calls: CodemodeNestedCall[] = [];
  const snapshot = (): CodemodeToolDetails => ({ calls: calls.map((call) => ({ ...call })) });
  const publish = () => input.call.update({ content: [], details: snapshot() });
  const { run } = input.call;
  const callable = run === undefined ? [] : run.tools.list();
  const samples = new Map(
    callable.map((tool) => [tool.name, renderToolSample(toCodemodeDeclaration(tool))]),
  );
  const sandboxTools: CodemodeTool[] = callable.map((tool) => ({
    name: tool.name,
    description: samples.get(tool.name),
    execute: async (args, { signal: callSignal }) => {
      const record: CodemodeNestedCall = {
        id: `${input.call.id}/${calls.length + 1}`,
        name: tool.name,
        args: previewArgs(args),
        status: "running",
      };
      calls.push(record);
      publish();
      const callStartedAt = performance.now();
      try {
        if (run === undefined) throw new Error("Tool calls need a run");
        const outcome = await run.tools.execute(tool.name, args, { signal: callSignal });
        record.durationMs = performance.now() - callStartedAt;
        if (outcome.kind === "error") {
          record.status = callSignal.aborted ? "cancelled" : "error";
          record.error = truncateText(
            contentText(outcome.result.content ?? []) || `Tool "${tool.name}" failed`,
            ERROR_PREVIEW_CHARS,
          );
        } else {
          record.status = callSignal.aborted ? "cancelled" : "ok";
        }
        publish();
        return toScriptValue(tool, outcome);
      } catch (error) {
        record.durationMs = performance.now() - callStartedAt;
        record.status = callSignal.aborted ? "cancelled" : "error";
        record.error = truncateText(
          error instanceof Error ? error.message : String(error),
          ERROR_PREVIEW_CHARS,
        );
        publish();
        throw error;
      }
    },
  }));
  const sandbox = new CodemodeSandbox({
    ...input.runtime,
    tools: sandboxTools,
    globals: createDiscoveryGlobals(callable, samples),
    timeoutMs: sourceOptions.timeoutMs ?? Number.POSITIVE_INFINITY,
    memoryLimitBytes: CODEMODE_MEMORY_LIMIT_BYTES,
  });
  let result: CodemodeResult;
  try {
    result = await sandbox.execute(code, {
      signal: input.call.signal,
      store: readCodemodeStore(run === undefined ? [] : await run.history()),
    });
  } finally {
    await sandbox.close();
  }
  for (const call of calls) {
    if (call.status === "running") call.status = "cancelled";
  }
  const items: (TextContent | ImageContent)[] = result.output.map((item) => ({ ...item }));
  if (result.ok) {
    if (result.value !== undefined) items.push({ type: "text", text: valueText(result.value) });
  } else {
    items.push({ type: "text", text: `Script error:\n${formatError(result, calls)}` });
  }
  const truncated = await truncateOutput(
    items,
    sourceOptions.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
  );
  const wallTime = ((performance.now() - startedAt) / 1000).toFixed(1);
  const header = `${result.ok ? "Script completed" : "Script failed"}\nWall time ${wallTime} seconds\nOutput:\n`;
  const details = snapshot();
  if (truncated.fullOutputPath) details.fullOutputPath = truncated.fullOutputPath;
  if (result.ok) details.storeWrites = result.storeWrites;
  const output = {
    content: [{ type: "text", text: header } satisfies TextContent, ...truncated.items],
    details,
  };
  if (!result.ok) throw new ToolError(output);
  return output;
}
