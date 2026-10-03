import { isJsonObject, toJsonValue, type JsonObject } from "@nyte-ai/client";
import type { ImageContent, TextContent, ToolResultMessage } from "@nyte-ai/schema";
import type { AgentToolResult, ToolCallOutcome } from "./types.ts";

/** Wraps plain text as tool-result content. */
export function toolResultContent(text: string): TextContent[] {
  return [{ type: "text", text }];
}

/** Flattens tool-result content to text. Image parts become placeholders. */
export function toolResultText(content: (TextContent | ImageContent)[]): string {
  return content
    .map((part) => (part.type === "text" ? part.text : `[image ${part.mimeType}]`))
    .join("\n");
}

/** A failed tool execution whose structured result must survive settlement. */
export class ToolError<TDetails = unknown> extends Error {
  readonly result: AgentToolResult<TDetails>;

  constructor(result: AgentToolResult<TDetails>) {
    super(toolResultText(result.content).trim() || "Tool execution failed");
    this.name = "ToolError";
    this.result = result;
  }
}

/**
 * Preserves a structured tool failure and normalizes every other thrown value.
 * With `lastPartial`, the settlement keeps the last progress the tool reported
 * (invariant 31): partial content after the error text, the partial's details
 * and title filling gaps the error left. A `ToolError` is the tool's own
 * structured decision and is not amended.
 */
export function toolErrorResult(
  cause: unknown,
  lastPartial?: AgentToolResult<unknown>,
): AgentToolResult<unknown> {
  if (cause instanceof ToolError) return cause.result;

  const result: AgentToolResult<unknown> = {
    content: [
      ...toolResultContent(cause instanceof Error ? cause.message : String(cause)),
      ...(lastPartial?.content ?? []),
    ],
    details: lastPartial?.details === undefined ? {} : lastPartial.details,
  };

  if (lastPartial?.title !== undefined) {
    result.title = lastPartial.title;
  }

  if (lastPartial?.structuredContent !== undefined) {
    result.structuredContent = lastPartial.structuredContent;
  }

  return result;
}

export function toolSuccess<TDetails>(
  result: AgentToolResult<TDetails>,
): ToolCallOutcome<TDetails> {
  return { kind: "success", result };
}

/** A failed outcome for `cause`, a thrown value or a message; see `toolErrorResult`. */
export function toolFailure(
  cause: unknown,
  lastPartial?: AgentToolResult<unknown>,
): ToolCallOutcome {
  return { kind: "error", result: toolErrorResult(cause, lastPartial) };
}

/** Tool-call arguments as the durable log will replay them. */
export function toolCallArguments(value: unknown): JsonObject {
  const json = toJsonValue(value);

  if (!isJsonObject(json)) throw new Error("Tool arguments must be an object");

  return json;
}

/**
 * The settlement message for one tool call: what the model reads back and
 * what the session log stores. Every settlement, live or recovered, is built
 * here so the two never drift.
 */
export function toolResultMessage(
  call: { readonly toolCallId: string; readonly toolName: string },
  outcome: ToolCallOutcome,
): ToolResultMessage {
  const { result } = outcome;
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    // Untyped tools (JS extensions) can return results without content; normalize
    // so the null never enters session history or provider payloads.
    content: result.content ?? [],
    details: result.details,
    isError: outcome.kind === "error",
    timestamp: Date.now(),
  };

  if (result.structuredContent !== undefined) message.structuredContent = result.structuredContent;

  if (result.title !== undefined) message.title = result.title;

  if (result.usage !== undefined) message.usage = result.usage;

  if (result.addedToolNames !== undefined && result.addedToolNames.length > 0) {
    message.addedToolNames = result.addedToolNames;
  }

  return message;
}
