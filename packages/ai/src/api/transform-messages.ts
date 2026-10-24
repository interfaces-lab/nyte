import type {
  Api,
  AssistantMessage,
  ImageContent,
  Message,
  Model,
  TextContent,
  ToolCall,
  ToolResultMessage,
} from "../types.ts";

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";

const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

const ERROR_TOOL_IMAGE_PLACEHOLDER = "(image attached after the tool results)";

function replaceImagesWithPlaceholder(
  content: (TextContent | ImageContent)[],
  placeholder: string,
): TextContent[] {
  const result: TextContent[] = [];
  let previousWasPlaceholder = false;

  for (const block of content) {
    if (block.type === "image") {
      if (!previousWasPlaceholder) {
        result.push({ type: "text", text: placeholder });
      }

      previousWasPlaceholder = true;
      continue;
    }

    result.push(block);
    previousWasPlaceholder = block.text === placeholder;
  }

  return result;
}

/**
 * Splits the images out of an error tool result, for APIs that reject anything but text in one
 * (Anthropic). Send `content` as the tool result, then `caption` and `images` after all tool
 * results of the turn, in the same user message. Undefined when the result needs no split.
 */
export function splitErrorToolResultImages(
  msg: ToolResultMessage,
): { content: TextContent[]; caption: string; images: ImageContent[] } | undefined {
  if (!msg.isError) return undefined;
  const images = msg.content.filter((block): block is ImageContent => block.type === "image");

  if (images.length === 0) return undefined;

  return {
    content: replaceImagesWithPlaceholder(msg.content, ERROR_TOOL_IMAGE_PLACEHOLDER),
    caption: `Images from the error result of tool call ${msg.toolCallId} (${msg.toolName}):`,
    images,
  };
}

function downgradeUnsupportedImages<TApi extends Api>(
  messages: Message[],
  model: Model<TApi>,
): Message[] {
  if (model.input.includes("image")) {
    return messages;
  }

  return messages.map((msg) => {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER),
      };
    }

    if (msg.role === "toolResult") {
      return {
        ...msg,
        content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER),
      };
    }

    return msg;
  });
}

/**
 * Normalize tool call ID for cross-provider compatibility.
 * OpenAI Responses API generates IDs that are 450+ chars with special characters like `|`.
 * Anthropic APIs require IDs matching ^[a-zA-Z0-9_-]+$ (max 64 chars).
 * Null or undefined content from untyped callers (custom tools, hand-built histories, old session
 * files) becomes an empty array first, so downstream code can rely on the type contract.
 */
export function transformMessages<TApi extends Api>(
  messages: Message[],
  model: Model<TApi>,
  normalizeToolCallId?: (id: string, model: Model<TApi>, source: AssistantMessage) => string,
): Message[] {
  const toolCallIdMap = new Map<string, string>();

  const normalizedMessages = messages.map((msg) =>
    msg.content == null ? { ...msg, content: [] } : msg,
  );

  const imageAwareMessages = downgradeUnsupportedImages(normalizedMessages, model);

  const transformed = imageAwareMessages.map((msg) => {
    if (msg.role === "system" || msg.role === "user") {
      return msg;
    }

    if (msg.role === "toolResult") {
      const normalizedId = toolCallIdMap.get(msg.toolCallId);

      if (normalizedId && normalizedId !== msg.toolCallId) {
        return { ...msg, toolCallId: normalizedId };
      }

      return msg;
    }

    if (msg.role === "assistant") {
      const isSameModel =
        msg.provider === model.provider && msg.api === model.api && msg.model === model.id;

      const transformedContent = msg.content.flatMap((block) => {
        if (block.type === "thinking") {
          if (block.redacted) {
            return isSameModel ? block : [];
          }

          if (isSameModel && block.thinkingSignature) return block;

          if (!block.thinking || block.thinking.trim() === "") return [];

          if (isSameModel) return block;

          return {
            type: "text" as const,
            text: block.thinking,
          };
        }

        if (block.type === "text") {
          if (isSameModel) return block;

          return {
            type: "text" as const,
            text: block.text,
          };
        }

        if (block.type === "toolCall") {
          let normalizedToolCall: ToolCall = block;

          if (!isSameModel && block.thoughtSignature) {
            normalizedToolCall = { ...block };
            delete normalizedToolCall.thoughtSignature;
          }

          if (!isSameModel && normalizeToolCallId) {
            const normalizedId = normalizeToolCallId(block.id, model, msg);

            if (normalizedId !== block.id) {
              toolCallIdMap.set(block.id, normalizedId);
              normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
            }
          }

          return normalizedToolCall;
        }

        return block;
      });

      return {
        ...msg,
        content: transformedContent,
      };
    }

    return msg;
  });

  const result: Message[] = [];
  let pendingToolCalls: ToolCall[] = [];
  let existingToolResultIds = new Set<string>();

  const heldSystemMessages: Message[] = [];

  const closePendingToolCalls = () => {
    if (pendingToolCalls.length > 0) {
      for (const tc of pendingToolCalls) {
        if (!existingToolResultIds.has(tc.id)) {
          result.push({
            role: "toolResult",
            toolCallId: tc.id,
            toolName: tc.name,
            content: [{ type: "text", text: "No result provided" }],
            isError: true,
            timestamp: Date.now(),
          });
        }
      }

      pendingToolCalls = [];
      existingToolResultIds = new Set();
    }

    result.push(...heldSystemMessages);
    heldSystemMessages.length = 0;
  };

  for (let i = 0; i < transformed.length; i++) {
    const msg = transformed[i];

    if (msg.role === "assistant") {
      closePendingToolCalls();

      if (msg.stopReason === "error" || msg.stopReason === "aborted") {
        continue;
      }

      const toolCalls = msg.content.filter((b) => b.type === "toolCall");

      if (toolCalls.length > 0) {
        pendingToolCalls = toolCalls;
        existingToolResultIds = new Set();
      }

      result.push(msg);
    } else if (msg.role === "toolResult") {
      existingToolResultIds.add(msg.toolCallId);
      result.push(msg);
    } else if (msg.role === "system") {
      if (pendingToolCalls.length > 0) {
        heldSystemMessages.push(msg);
      } else {
        result.push(msg);
      }
    } else {
      closePendingToolCalls();
      result.push(msg);
    }
  }

  closePendingToolCalls();

  return result;
}
