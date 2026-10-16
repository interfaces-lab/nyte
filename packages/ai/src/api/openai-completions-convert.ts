/**
 * Conversion of the neutral transcript and tools into Chat Completions
 * messages, the catalog compat they follow, and Anthropic-style cache control.
 */
import OpenAI from "openai";
import { Value } from "typebox/value";
import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionContentPart,
  ChatCompletionContentPartImage,
  ChatCompletionContentPartText,
  ChatCompletionDeveloperMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionSystemMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions.js";
import type {
  CacheRetention,
  JsonValue,
  Model,
  OpenAICompletionsCompat,
  Tool,
  TranscriptContext,
} from "../types.ts";
import { shortHash } from "../utils/hash.ts";
import { sanitizeSurrogates } from "../utils/sanitize-unicode.ts";
import { getSystemMessageText, renderSystemMessageUpdate } from "../utils/text.ts";
import { resolveTranscript, resolveTranscriptTools } from "../utils/transcript.ts";
import {
  getGrammarToolInput,
  getJsonSchemaToolParameters,
  resolveGrammarConstrainedSampling,
  resolveJsonSchemaStrictSampling,
} from "./constrained-sampling.ts";
import { transformMessages } from "./transform-messages.ts";
import {
  parseOpenAIReasoningDetails,
  parseLegacyEncryptedReasoningDetail,
  type OpenAICompletionsReasoningField,
  OpenAICompletionsReasoningFieldSchema,
  parseCopilotReasoningOpaque,
} from "./openai-completions-reasoning.ts";

export interface ConvertCompletionsMessagesOptions {
  grammarToolInputProperties?: ReadonlyMap<string, string>;
}

export type ResolvedOpenAICompletionsCompat = Omit<
  Required<OpenAICompletionsCompat>,
  | "cacheControlFormat"
  | "deferredToolsMode"
  | "supportsThinkingTokenBudget"
  | "thinkingTokenBudgetField"
  | "supportsMidConvoSystemMessages"
  | "supportsMidConvoToolAdditions"
> & {
  cacheControlFormat?: OpenAICompletionsCompat["cacheControlFormat"];
  deferredToolsMode?: OpenAICompletionsCompat["deferredToolsMode"];
  supportsThinkingTokenBudget?: OpenAICompletionsCompat["supportsThinkingTokenBudget"];
  thinkingTokenBudgetField?: OpenAICompletionsCompat["thinkingTokenBudgetField"];
  supportsMidConvoSystemMessages?: OpenAICompletionsCompat["supportsMidConvoSystemMessages"];
  supportsMidConvoToolAdditions?: OpenAICompletionsCompat["supportsMidConvoToolAdditions"];
};

/** What an OpenAI-compatible server supports when its catalog entry says nothing else. */
const DEFAULT_COMPAT: ResolvedOpenAICompletionsCompat = {
  supportsStore: true,
  supportsDeveloperRole: true,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
  supportsFinishReason: true,
  maxTokensField: "max_completion_tokens",
  requiresToolResultName: false,
  requiresAssistantAfterToolResult: false,
  requiresThinkingAsText: false,
  requiresReasoningContentOnAssistantMessages: false,
  thinkingFormat: "openai",
  openRouterRouting: {},
  vercelGatewayRouting: {},
  chatTemplateKwargs: {},
  chatTemplateArgs: {},
  zaiToolStream: false,
  supportsStrictMode: false,
  supportsOpenAIGrammarTools: false,
  sendSessionAffinityHeaders: false,
  sessionAffinityFormat: "openai",
  supportsLongCacheRetention: true,
};

/**
 * The model's compat over the defaults. The catalog generator stamps every provider quirk onto
 * `model.compat`, so nothing here sniffs the provider name or base URL.
 */
export function resolveCompat(model: Model<"openai-completions">): ResolvedOpenAICompletionsCompat {
  return { ...DEFAULT_COMPAT, ...model.compat };
}

type CompatToolResultMessage = ChatCompletionToolMessageParam & { name?: string };

type ChatCompletionInstructionMessageParam =
  | ChatCompletionDeveloperMessageParam
  | ChatCompletionSystemMessageParam
  | KimiToolSystemMessageParam;

type KimiToolSystemMessageParam = {
  role: "system";
  content?: never;
  tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
};

export type CompletionsMessage = ChatCompletionMessageParam | KimiToolSystemMessageParam;

function kimiToolSystemMessage(
  tools: Tool[],
  compat: ResolvedOpenAICompletionsCompat,
): KimiToolSystemMessageParam {
  return {
    role: "system",
    tools: convertTools(tools, compat),
  };
}

function getToolsByName(tools: Tool[] | undefined, names: Iterable<string>): Tool[] {
  if (!tools) return [];
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));

  return Array.from(names)
    .map((name) => toolsByName.get(name))
    .filter((tool) => tool !== undefined);
}

type ChatCompletionAssistantMessageParamWithReasoning = ChatCompletionAssistantMessageParam &
  Partial<Record<OpenAICompletionsReasoningField, string>> & {
    reasoning_details?: JsonValue[];
    reasoning_opaque?: string;
  };

type ChatCompletionTextPartWithCacheControl = ChatCompletionContentPartText & {
  cache_control?: OpenAICompatCacheControl;
};

interface OpenAICompatCacheControl {
  type: "ephemeral";
  ttl?: string;
}

export function getCompatCacheControl(
  compat: ResolvedOpenAICompletionsCompat,
  cacheRetention: CacheRetention,
): OpenAICompatCacheControl | undefined {
  if (compat.cacheControlFormat !== "anthropic" || cacheRetention === "none") {
    return undefined;
  }

  const cacheControl: OpenAICompatCacheControl = { type: "ephemeral" };

  if (cacheRetention === "long" && compat.supportsLongCacheRetention) cacheControl.ttl = "1h";

  return cacheControl;
}

export function applyAnthropicCacheControl(
  messages: CompletionsMessage[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  cacheControl: OpenAICompatCacheControl,
): void {
  addCacheControlToSystemPrompt(messages, cacheControl);
  addCacheControlToLastTool(tools, cacheControl);
  addCacheControlToLastConversationMessage(messages, cacheControl);
}

function addCacheControlToSystemPrompt(
  messages: CompletionsMessage[],
  cacheControl: OpenAICompatCacheControl,
): void {
  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      addCacheControlToTextContent(message, cacheControl);

      return;
    }
  }
}

function addCacheControlToLastConversationMessage(
  messages: CompletionsMessage[],
  cacheControl: OpenAICompatCacheControl,
): void {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];

    if (message.role === "user" || message.role === "assistant" || message.role === "tool") {
      if (addCacheControlToMessage(message, cacheControl)) {
        return;
      }
    }
  }
}

function addCacheControlToLastTool(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
  cacheControl: OpenAICompatCacheControl,
): void {
  if (!tools || tools.length === 0) {
    return;
  }

  Object.assign(tools[tools.length - 1], { cache_control: cacheControl });
}

function addCacheControlToMessage(
  message: CompletionsMessage,
  cacheControl: OpenAICompatCacheControl,
): boolean {
  if (message.role === "user" || message.role === "assistant" || message.role === "tool") {
    return addCacheControlToTextContent(message, cacheControl);
  }

  return false;
}

function addCacheControlToTextContent(
  message:
    | ChatCompletionInstructionMessageParam
    | ChatCompletionAssistantMessageParam
    | ChatCompletionToolMessageParam
    | Extract<ChatCompletionMessageParam, { role: "user" }>,
  cacheControl: OpenAICompatCacheControl,
): boolean {
  const content = message.content;

  if (Array.isArray(content)) {
    const textPart = content.findLast((part) => part?.type === "text");

    if (textPart === undefined) return false;
    Object.assign(textPart, { cache_control: cacheControl });

    return true;
  }

  if (!content) {
    return false;
  }

  const textPart: ChatCompletionTextPartWithCacheControl = {
    type: "text",
    text: content,
    cache_control: cacheControl,
  };

  message.content = [textPart];

  return true;
}

/**
 * A tool call id Chat Completions accepts. Responses-style ids are `{call_id}|{item_id}`,
 * where the item id can be 400+ characters with `+`, `/` and `=` (github-copilot,
 * openai-codex, opencode). Calls in one turn can share a call id and differ by item id, and
 * Chat Completions requires distinct ids, so both parts are kept, sanitized, and hashed down to
 * OpenAI's 40-character limit when too long.
 */
function normalizeToolCallId(id: string, provider: string): string {
  if (id.includes("|")) {
    const [rawCallId, ...itemParts] = id.split("|");
    const callId = rawCallId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const itemId = itemParts.join("|").replace(/[^a-zA-Z0-9_-]/g, "_");
    const combinedId = itemId.length > 0 ? `${callId}_${itemId}` : callId;

    if (combinedId.length <= 40) {
      return combinedId;
    }

    const hash = shortHash(id).slice(0, 8);
    const prefix = callId.slice(0, Math.max(1, 40 - hash.length - 1));

    return `${prefix}_${hash}`;
  }

  if (provider === "openai") return id.length > 40 ? id.slice(0, 40) : id;

  return id;
}

/**
 * The transcript as Chat Completions messages, shaped by the model's compat.
 *
 * - Tool results load request-list tools through `addedToolNames` only in Kimi mode; anchored
 *   additions are not in the request list, so neither path declares a tool twice.
 * - Some providers reject a user message right after tool results, so a synthetic assistant
 *   message bridges the gap; some reject null assistant content, so it is an empty string.
 * - Copilot accepts reasoning text only alongside its opaque state; text without the state is
 *   dropped rather than replayed as a bare field.
 * - Thinking replayed as text carries no tags, so the model does not mimic them.
 * - `reasoning_details` is the structured alternative to a raw reasoning field; without it the
 *   first thinking block's signature names the field (llama.cpp server with gpt-oss).
 * - Assistant messages with neither content nor tool calls are skipped: providers require one
 *   of them, and aborted responses can have neither.
 * - Every tool result carries text, a placeholder when it has only images, and its tool name
 *   for providers that require it.
 */
export function convertMessages(
  model: Model<"openai-completions">,
  context: TranscriptContext,
  compat: ResolvedOpenAICompletionsCompat,
  options?: ConvertCompletionsMessagesOptions,
): CompletionsMessage[] {
  const normalizedContext = resolveTranscript(context, compat.supportsMidConvoSystemMessages);
  const params: CompletionsMessage[] = [];

  const transformedMessages = transformMessages(normalizedContext.messages, model, (id) =>
    normalizeToolCallId(id, model.provider),
  );

  const transcriptTools = resolveTranscriptTools(
    normalizedContext.messages,
    compat.supportsMidConvoSystemMessages === true && compat.supportsMidConvoToolAdditions === true,
  );

  const requestTools = compat.deferredToolsMode === "kimi" ? transcriptTools.requestTools : [];
  const instructionRole = model.reasoning && compat.supportsDeveloperRole ? "developer" : "system";

  let lastRole: string | null = null;

  for (let i = 0; i < transformedMessages.length; i++) {
    const msg = transformedMessages[i];

    if (
      compat.requiresAssistantAfterToolResult &&
      lastRole === "toolResult" &&
      msg.role === "user"
    ) {
      params.push({
        role: "assistant",
        content: "I have processed the tool results.",
      });
    }

    if (msg.role === "system") {
      const addedTools = i > 0 && transcriptTools.anchorsAdditions ? (msg.toolsAdded ?? []) : [];

      if (addedTools.length > 0) {
        params.push(kimiToolSystemMessage(addedTools, compat));
      }

      const text = i === 0 ? getSystemMessageText(msg) : renderSystemMessageUpdate(msg);

      if (text.length > 0) {
        params.push({ role: instructionRole, content: sanitizeSurrogates(text) });
      }
    } else if (msg.role === "user") {
      if (!Array.isArray(msg.content)) {
        params.push({
          role: "user",
          content: sanitizeSurrogates(msg.content),
        });
      } else {
        const content: ChatCompletionContentPart[] = msg.content
          .filter((item) => item.type !== "text" || item.text.length > 0)
          .map((item): ChatCompletionContentPart => {
            if (item.type === "text") {
              return {
                type: "text",
                text: sanitizeSurrogates(item.text),
              } satisfies ChatCompletionContentPartText;
            } else {
              return {
                type: "image_url",
                image_url: {
                  url: `data:${item.mimeType};base64,${item.data}`,
                },
              } satisfies ChatCompletionContentPartImage;
            }
          });

        if (content.length === 0) continue;
        params.push({
          role: "user",
          content,
        });
      }
    } else if (msg.role === "assistant") {
      const assistantMsg: ChatCompletionAssistantMessageParamWithReasoning = {
        role: "assistant",
        content: compat.requiresAssistantAfterToolResult ? "" : null,
      };

      const assistantTextParts = msg.content
        .filter((block) => block.type === "text")
        .filter((block) => block.text.trim().length > 0)
        .map(
          (block) =>
            ({
              type: "text",
              text: sanitizeSurrogates(block.text),
            }) satisfies ChatCompletionContentPartText,
        );

      const assistantText = assistantTextParts.map((part) => part.text).join("");

      const thinkingBlocks = msg.content.filter((block) => block.type === "thinking");
      const toolCalls = msg.content.filter((block) => block.type === "toolCall");

      const signedReasoningDetails = thinkingBlocks
        .map((block) => parseOpenAIReasoningDetails(block.thinkingSignature))
        .find((details) => details !== undefined);

      const legacyReasoningDetails = toolCalls
        .map((toolCall) => parseLegacyEncryptedReasoningDetail(toolCall.thoughtSignature))
        .filter((detail) => detail !== undefined);

      const preservedReasoningDetails =
        signedReasoningDetails ??
        (legacyReasoningDetails.length > 0 ? legacyReasoningDetails : undefined);

      const nonEmptyThinkingBlocks = thinkingBlocks.filter(
        (block) => block.thinking.trim().length > 0,
      );

      const copilotReasoningOpaque =
        model.provider === "github-copilot"
          ? thinkingBlocks
              .map((block) => parseCopilotReasoningOpaque(block.thinkingSignature))
              .find((opaque) => opaque !== undefined)
          : undefined;

      if (model.provider === "github-copilot") {
        if (assistantText.length > 0) {
          assistantMsg.content = assistantText;
        }

        if (copilotReasoningOpaque !== undefined) {
          assistantMsg.reasoning_opaque = copilotReasoningOpaque;

          if (nonEmptyThinkingBlocks.length > 0) {
            assistantMsg.reasoning_text = nonEmptyThinkingBlocks
              .map((block) => block.thinking)
              .join("\n");
          }
        }
      } else if (nonEmptyThinkingBlocks.length > 0) {
        if (compat.requiresThinkingAsText) {
          const thinkingText = nonEmptyThinkingBlocks
            .map((block) => sanitizeSurrogates(block.thinking))
            .join("\n\n");

          assistantMsg.content = [{ type: "text", text: thinkingText }, ...assistantTextParts];
        } else {
          if (assistantText.length > 0) {
            assistantMsg.content = assistantText;
          }

          if (!preservedReasoningDetails) {
            let signature = nonEmptyThinkingBlocks[0].thinkingSignature;

            if (model.provider === "opencode-go" && signature === "reasoning") {
              signature = "reasoning_content";
            }

            if (signature && Value.Check(OpenAICompletionsReasoningFieldSchema, signature)) {
              assistantMsg[signature] = nonEmptyThinkingBlocks
                .map((block) => block.thinking)
                .join("\n");
            }
          }
        }
      } else if (assistantText.length > 0) {
        assistantMsg.content = assistantText;
      }

      if (toolCalls.length > 0) {
        assistantMsg.tool_calls = toolCalls.map((tc): ChatCompletionMessageToolCall => {
          const customInputProperty = options?.grammarToolInputProperties?.get(tc.name);

          if (customInputProperty !== undefined) {
            return {
              id: tc.id,
              type: "custom",
              custom: {
                name: tc.name,
                input: sanitizeSurrogates(
                  getGrammarToolInput(tc.name, tc.arguments, customInputProperty),
                ),
              },
            };
          }

          return {
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          };
        });
      }

      if (preservedReasoningDetails) {
        assistantMsg.reasoning_details = preservedReasoningDetails;
      }

      if (
        compat.requiresReasoningContentOnAssistantMessages &&
        model.reasoning &&
        assistantMsg.reasoning_content === undefined
      ) {
        assistantMsg.reasoning_content = "";
      }

      const content = assistantMsg.content;
      const hasContent = content !== null && content !== undefined && content.length > 0;

      if (!hasContent && !assistantMsg.tool_calls) {
        continue;
      }

      params.push(assistantMsg);
    } else if (msg.role === "toolResult") {
      const imageBlocks: Array<{ type: "image_url"; image_url: { url: string } }> = [];
      const deferredToolNames = new Set<string>();
      let j = i;

      for (; j < transformedMessages.length; j++) {
        const toolMsg = transformedMessages[j];

        if (toolMsg.role !== "toolResult") break;

        const textResult = toolMsg.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n");

        const hasImages = toolMsg.content.some((c) => c.type === "image");

        const hasText = textResult.length > 0;

        const toolResultText = hasText
          ? textResult
          : hasImages
            ? "(see attached image)"
            : "(no tool output)";

        const toolResultMsg: CompatToolResultMessage = {
          role: "tool",
          content: sanitizeSurrogates(toolResultText),
          tool_call_id: toolMsg.toolCallId,
        };

        if (compat.requiresToolResultName && toolMsg.toolName) {
          toolResultMsg.name = toolMsg.toolName;
        }

        params.push(toolResultMsg);

        if (compat.deferredToolsMode === "kimi") {
          for (const name of toolMsg.addedToolNames ?? []) {
            deferredToolNames.add(name);
          }
        }

        if (hasImages && model.input.includes("image")) {
          for (const block of toolMsg.content) {
            if (block.type === "image") {
              imageBlocks.push({
                type: "image_url",
                image_url: {
                  url: `data:${block.mimeType};base64,${block.data}`,
                },
              });
            }
          }
        }
      }

      i = j - 1;

      if (imageBlocks.length > 0) {
        if (compat.requiresAssistantAfterToolResult) {
          params.push({
            role: "assistant",
            content: "I have processed the tool results.",
          });
        }

        params.push({
          role: "user",
          content: [
            {
              type: "text",
              text: "Attached image(s) from tool result:",
            },
            ...imageBlocks,
          ],
        });
        lastRole = "user";
      } else {
        lastRole = "toolResult";
      }

      if (deferredToolNames.size > 0) {
        const deferredTools = getToolsByName(requestTools, deferredToolNames);

        if (deferredTools.length > 0) {
          params.push(kimiToolSystemMessage(deferredTools, compat));
        }
      }

      continue;
    }

    lastRole = msg.role;
  }

  return params;
}

/**
 * Only include strict if provider supports it. Some reject unknown fields.
 */
export function convertTools(
  tools: Tool[],
  compat: ResolvedOpenAICompletionsCompat,
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((tool) => {
    const grammar = resolveGrammarConstrainedSampling(tool, compat.supportsOpenAIGrammarTools);

    if (grammar) {
      return {
        type: "custom",
        custom: {
          name: tool.name,
          description: tool.description,
          format: {
            type: "grammar",
            grammar: {
              syntax: grammar.format,
              definition: grammar.definition,
            },
          },
        },
      };
    }

    const strict = resolveJsonSchemaStrictSampling(tool, compat.supportsStrictMode !== false);

    return {
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: getJsonSchemaToolParameters(tool, strict),
        ...(compat.supportsStrictMode !== false && { strict: strict ?? false }),
      },
    };
  });
}
