/**
 * Conversion of the neutral transcript and tools into Anthropic Messages
 * request content.
 */
import { IsProperties, IsRequired } from "typebox/schema";
import type {
  BetaTool,
  BetaCacheControlEphemeral,
  BetaContentBlockParam,
  BetaImageBlockParam,
  BetaMessageParam,
  BetaSystemMessageParam,
  BetaTextBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages.js";
import type { ImageContent, Message, TextContent, Tool, ToolResultMessage } from "../types.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { renderSystemMessageUpdate } from "../utils/text.ts";
import {
  getJsonSchemaToolParameters,
  resolveJsonSchemaStrictSampling,
  type UnsupportedStrictSchemaKeywordCheck,
} from "./constrained-sampling.ts";
import { toClaudeCodeName } from "./claude-code.ts";
import { splitErrorToolResultImages } from "./transform-messages.ts";

const ANTHROPIC_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

function convertImageBlock(image: ImageContent): BetaImageBlockParam {
  const mediaType = ANTHROPIC_IMAGE_MEDIA_TYPES.find((type) => type === image.mimeType);

  if (mediaType === undefined) {
    throw new Error(`Anthropic does not support ${image.mimeType} images`);
  }

  return { type: "image", source: { type: "base64", media_type: mediaType, data: image.data } };
}

/**
 * Convert content blocks to Anthropic API format
 */
function convertContentBlocks(
  content: (TextContent | ImageContent)[],
): string | Array<BetaTextBlockParam | BetaImageBlockParam> {
  const hasImages = content.some((c) => c.type === "image");

  if (!hasImages) {
    return sanitizeSurrogates(content.map((c) => (c.type === "text" ? c.text : "")).join("\n"));
  }

  const blocks = content.map((block): BetaTextBlockParam | BetaImageBlockParam =>
    block.type === "text"
      ? { type: "text", text: sanitizeSurrogates(block.text) }
      : convertImageBlock(block),
  );

  const hasText = blocks.some((b) => b.type === "text");

  if (!hasText) {
    blocks.unshift({
      type: "text",
      text: "(see attached image)",
    });
  }

  return blocks;
}

export function normalizeToolCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

interface ConvertedToolResult {
  toolResult: BetaContentBlockParam;
  siblingContent: BetaContentBlockParam[];
}

/**
 * One tool result as a `tool_result` block. Anthropic rejects tool references mixed with
 * ordinary tool-result content, so a result that loads deferred tools carries only the
 * references and its own content moves into sibling blocks.
 */
function convertToolResult(
  msg: ToolResultMessage,
  isOAuthToken: boolean,
  deferredToolNames: ReadonlySet<string>,
  loadedToolNames: Set<string>,
  normalizeToolName: (name: string) => string,
): ConvertedToolResult {
  const references: Array<{ type: "tool_reference"; tool_name: string }> = [];

  for (const name of msg.addedToolNames ?? []) {
    const normalizedName = normalizeToolName(name);

    if (!deferredToolNames.has(normalizedName) || loadedToolNames.has(normalizedName)) continue;
    loadedToolNames.add(normalizedName);
    references.push({
      type: "tool_reference",
      tool_name: isOAuthToken ? toClaudeCodeName(name) : name,
    });
  }

  const convertedContent = convertContentBlocks(msg.content);

  return {
    toolResult: {
      type: "tool_result",
      tool_use_id: msg.toolCallId,
      content: references.length > 0 ? references : convertedContent,
      is_error: msg.isError,
    },
    siblingContent:
      references.length === 0
        ? []
        : Array.isArray(convertedContent)
          ? convertedContent
          : [{ type: "text", text: convertedContent }],
  };
}

/**
 * The transcript as Anthropic messages.
 *
 * - Anthropic requires `tool_result` immediately after `tool_use`, so system updates are held
 *   until the next assistant message that is sent, or the end of the transcript. Holding past an
 *   assistant message that converts to no blocks keeps the update from landing before a user
 *   message, which Anthropic rejects.
 * - A thinking block whose signature is missing or empty, e.g. from an aborted stream, becomes
 *   plain text; models marked `allowEmptySignature` emit and accept empty signatures, so they
 *   keep the block.
 * - Consecutive tool results go into one user message, which the z.ai Anthropic endpoint needs;
 *   content displaced by tool references, and the images of error results (which Anthropic
 *   rejects inside them), follow every `tool_result` block.
 * - The last user or system message carries `cache_control`, caching the conversation history.
 */
export function convertMessages(
  transformedMessages: Message[],
  isOAuthToken: boolean,
  cacheControl?: BetaCacheControlEphemeral,
  allowEmptySignature = false,
  deferredToolNames: ReadonlySet<string> = new Set(),
  normalizeToolName: (name: string) => string = (name) => name,
  nativeToolChanges = false,
): BetaMessageParam[] {
  const params: BetaMessageParam[] = [];
  const loadedToolNames = new Set<string>();

  const pendingSystemMessages: BetaMessageParam[] = [];

  const flushPendingSystemMessages = (): void => {
    params.push(...pendingSystemMessages);
    pendingSystemMessages.length = 0;
  };

  for (let i = 0; i < transformedMessages.length; i++) {
    const msg = transformedMessages[i];

    if (msg.role === "system") {
      const text = renderSystemMessageUpdate(msg);
      const blocks: Exclude<BetaSystemMessageParam["content"], string | undefined> = [];

      if (text.length > 0) blocks.push({ type: "text", text: sanitizeSurrogates(text) });

      if (nativeToolChanges) {
        for (const tool of msg.toolsRemoved ?? []) {
          blocks.push({
            type: "tool_removal",
            tool: {
              type: "tool_reference",
              name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
            },
          });
        }

        for (const tool of msg.toolsAdded ?? []) {
          blocks.push({
            type: "tool_addition",
            tool: {
              type: "tool_reference",
              name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
            },
          });
        }
      }

      if (blocks.length > 0) pendingSystemMessages.push({ role: "system", content: blocks });
    } else if (msg.role === "user") {
      if (!Array.isArray(msg.content)) {
        if (msg.content.trim().length > 0) {
          params.push({
            role: "user",
            content: sanitizeSurrogates(msg.content),
          });
        }
      } else {
        const blocks: BetaContentBlockParam[] = msg.content.map((item) => {
          if (item.type === "text") {
            return {
              type: "text",
              text: sanitizeSurrogates(item.text),
            };
          } else {
            return convertImageBlock(item);
          }
        });

        const filteredBlocks = blocks.filter((b) => {
          if (b.type === "text") {
            return b.text.trim().length > 0;
          }

          return true;
        });

        if (filteredBlocks.length === 0) continue;
        params.push({
          role: "user",
          content: filteredBlocks,
        });
      }
    } else if (msg.role === "assistant") {
      const blocks: BetaContentBlockParam[] = [];

      for (const block of msg.content) {
        if (block.type === "text") {
          if (block.text.trim().length === 0) continue;
          blocks.push({
            type: "text",
            text: sanitizeSurrogates(block.text),
          });
        } else if (block.type === "thinking") {
          if (block.redacted) {
            blocks.push({
              type: "redacted_thinking",
              data: block.thinkingSignature!,
            });
            continue;
          }

          const thinkingSignature = block.thinkingSignature;
          const hasThinkingSignature = !!thinkingSignature && thinkingSignature.trim().length > 0;

          if (block.thinking.trim().length === 0 && !hasThinkingSignature) continue;

          if (!hasThinkingSignature) {
            blocks.push(
              allowEmptySignature
                ? {
                    type: "thinking",
                    thinking: sanitizeSurrogates(block.thinking),
                    signature: "",
                  }
                : {
                    type: "text",
                    text: sanitizeSurrogates(block.thinking),
                  },
            );
          } else {
            blocks.push({
              type: "thinking",
              thinking: sanitizeSurrogates(block.thinking),
              signature: thinkingSignature,
            });
          }
        } else if (block.type === "toolCall") {
          blocks.push({
            type: "tool_use",
            id: block.id,
            name: isOAuthToken ? toClaudeCodeName(block.name) : block.name,
            input: block.arguments ?? {},
          });
        }
      }

      if (blocks.length === 0) continue;
      flushPendingSystemMessages();
      params.push({
        role: "assistant",
        content: blocks,
      });
    } else if (msg.role === "toolResult") {
      const toolResults: BetaContentBlockParam[] = [];
      const siblingContent: BetaContentBlockParam[] = [];
      let j = i;

      for (; j < transformedMessages.length; j++) {
        const next = transformedMessages[j];

        if (next.role !== "toolResult") break;

        const split = splitErrorToolResultImages(next);

        const converted = convertToolResult(
          split ? { ...next, content: split.content } : next,
          isOAuthToken,
          deferredToolNames,
          loadedToolNames,
          normalizeToolName,
        );

        toolResults.push(converted.toolResult);
        siblingContent.push(...converted.siblingContent);

        if (split) {
          siblingContent.push(
            { type: "text", text: split.caption },
            ...split.images.map(convertImageBlock),
          );
        }
      }

      i = j - 1;

      params.push({
        role: "user",
        content: [...toolResults, ...siblingContent],
      });
    }
  }

  flushPendingSystemMessages();

  if (cacheControl && params.length > 0) {
    const lastMessage = params[params.length - 1];

    if (lastMessage.role === "user" || lastMessage.role === "system") {
      if (Array.isArray(lastMessage.content)) {
        const lastBlock = lastMessage.content[lastMessage.content.length - 1];

        if (
          lastBlock &&
          (lastBlock.type === "text" ||
            lastBlock.type === "image" ||
            lastBlock.type === "tool_result" ||
            lastBlock.type === "tool_addition" ||
            lastBlock.type === "tool_removal")
        ) {
          lastBlock.cache_control = cacheControl;
        }
      } else if (typeof lastMessage.content === "string") {
        lastMessage.content = [
          {
            type: "text",
            text: lastMessage.content,
            cache_control: cacheControl,
          },
        ];
      }
    }
  }

  return params;
}

/**
 * Keywords Anthropic strict tool use rejects with a 400 for the whole request.
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations
 */
const ANTHROPIC_STRICT_UNSUPPORTED_KEYWORDS = new Set([
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "maxItems",
  "uniqueItems",
  "minContains",
  "maxContains",
  "minProperties",
  "maxProperties",
]);

const ANTHROPIC_STRICT_STRING_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "uri",
  "ipv4",
  "ipv6",
  "uuid",
]);

const rejectedByAnthropicStrictTools: UnsupportedStrictSchemaKeywordCheck = (key, value) => {
  if (ANTHROPIC_STRICT_UNSUPPORTED_KEYWORDS.has(key)) return true;
  if (key === "minItems") return value !== 0 && value !== 1;
  if (key === "format")
    return typeof value !== "string" || !ANTHROPIC_STRICT_STRING_FORMATS.has(value);
  return false;
};

/** Whether the tool asks for strict sampling only where the provider can honor it. */
export function prefersStrictSampling(tool: Tool): boolean {
  const config = tool.constrainedSampling;

  return (
    config !== undefined &&
    config !== false &&
    config.type === "json_schema" &&
    config.strict === "prefer"
  );
}

/** `disablePreferredStrictTools` sends `prefer` tools non-strict; `require` tools stay strict. */
export function convertTools(
  tools: Tool[],
  isOAuthToken: boolean,
  supportsEagerToolInputStreaming: boolean,
  supportsStrictTools: boolean,
  cacheControl?: BetaCacheControlEphemeral,
  deferLoading = false,
  disablePreferredStrictTools = false,
): BetaTool[] {
  if (!tools) return [];

  return tools.map((tool, index) => {
    const strict =
      disablePreferredStrictTools && prefersStrictSampling(tool)
        ? undefined
        : resolveJsonSchemaStrictSampling(
            tool,
            supportsStrictTools,
            rejectedByAnthropicStrictTools,
          );
    const parameters = getJsonSchemaToolParameters(tool, strict);

    const legacyInputSchema = {
      type: "object" as const,
      properties: IsProperties(parameters) ? parameters.properties : {},
      required: IsRequired(parameters) ? parameters.required : [],
    };

    const converted: BetaTool = {
      name: isOAuthToken ? toClaudeCodeName(tool.name) : tool.name,
      description: tool.description,
      input_schema: strict === true ? { ...parameters, ...legacyInputSchema } : legacyInputSchema,
    };

    if (supportsEagerToolInputStreaming) converted.eager_input_streaming = true;

    if (strict === true) converted.strict = true;

    if (deferLoading) converted.defer_loading = true;

    if (cacheControl && index === tools.length - 1) converted.cache_control = cacheControl;

    return converted;
  });
}
