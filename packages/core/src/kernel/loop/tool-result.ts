import type { ImageContent, TextContent } from "@nyte-ai/schema";
import type { AgentToolResult } from "./types.ts";

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

  return result;
}
