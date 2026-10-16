/**
 * Conversion of the neutral transcript and tools into Responses API input,
 * shared by the OpenAI Responses and Codex adapters.
 */
import type {
  CustomTool,
  FunctionTool,
  ResponseInputContent,
  ResponseInputImage,
  ResponseInputItem,
  ResponseInputText,
  ResponseOutputMessage,
  ResponseCustomToolCall,
  ResponseFunctionToolCall,
  ResponseToolSearchOutputItemParam,
} from "openai/resources/responses/responses.js";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { TextSignatureV1Schema } from "@nyte-ai/schema/model";
import type {
  Api,
  AssistantMessage,
  ImageContent,
  Model,
  SystemMessage,
  TextContent,
  TextSignatureV1,
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

/** A function tool as sent; `strict` is omitted for providers that reject or ignore the field. */
export type ResponsesFunctionTool = Omit<FunctionTool, "strict"> &
  Partial<Pick<FunctionTool, "strict">>;

export type ResponsesTool = CustomTool | ResponsesFunctionTool;

/** Loads deferred tools in place, for providers that support `additional_tools`. */
interface ResponsesAdditionalToolsItem {
  type: "additional_tools";
  role: "developer";
  tools: ResponsesTool[];
}

/** A client-executed tool search result, which loads deferred tools for `tool-search` providers. */
interface ResponsesToolSearchOutputItem extends Omit<ResponseToolSearchOutputItemParam, "tools"> {
  tools: ResponsesTool[];
}

/** An item the matching provider produced, replayed verbatim. */
const ReplayedItemSchema = Type.Object({ type: Type.String() });

/** Checkpoint material: the provider's own opaque window of items. */
const CheckpointItemsSchema = Type.Array(ReplayedItemSchema);

/** A reasoning item stored whole in a thinking signature by the stream processor. */
const ReplayedReasoningSchema = Type.Object({ type: Type.Literal("reasoning") });

export type ReplayedResponsesItem = Static<typeof ReplayedItemSchema>;

export type ResponsesInputItem =
  | ResponseInputItem
  | ResponsesAdditionalToolsItem
  | ResponsesToolSearchOutputItem
  | ReplayedResponsesItem;

export type ResponsesInput = ResponsesInputItem[];

export function encodeTextSignatureV1(id: string, phase?: TextSignatureV1["phase"]): string {
  const payload: TextSignatureV1 = { v: 1, id };

  if (phase) payload.phase = phase;

  return JSON.stringify(payload);
}

/** A text signature: the v1 JSON payload, or a legacy plain-string message id. */
function parseTextSignature(
  signature: string | undefined,
): { id: string; phase?: TextSignatureV1["phase"] } | undefined {
  if (!signature) return undefined;

  if (signature.startsWith("{")) {
    try {
      const parsed = JSON.parse(signature);

      if (Value.Check(TextSignatureV1Schema, parsed)) return parsed;
    } catch {}
  }

  return { id: signature };
}

type ToolResultOutputContent = Array<ResponseInputText | ResponseInputImage>;

function convertToolResultOutput<TApi extends Api>(
  model: Model<TApi>,
  content: readonly (TextContent | ImageContent)[],
): string | ToolResultOutputContent {
  const textResult = content.flatMap((c) => (c.type === "text" ? [c.text] : [])).join("\n");

  const images = content.filter((c) => c.type === "image");
  const hasText = textResult.length > 0;

  if (images.length === 0 || !model.input.includes("image")) {
    return sanitizeSurrogates(
      hasText ? textResult : images.length > 0 ? "(see attached image)" : "(no tool output)",
    );
  }

  const output: ToolResultOutputContent = [];

  if (hasText) {
    output.push({ type: "input_text", text: sanitizeSurrogates(textResult) });
  }

  for (const image of images) {
    output.push({
      type: "input_image",
      detail: "auto",
      image_url: `data:${image.mimeType};base64,${image.data}`,
    });
  }

  return output;
}

export interface ConvertResponsesMessagesOptions {
  includeSystemPrompt?: boolean;
  grammarToolInputProperties?: ReadonlyMap<string, string>;
  /** Whether later system messages are sent in place; otherwise they are folded into the leading prompt. */
  supportsMidConvoSystemMessages?: boolean;
  /** Request-list tools that tool results load via `addedToolNames`. */
  deferredTools?: ReadonlyMap<string, Tool>;
  /** How late tools reach the model: system-message anchors and `addedToolNames` loads share it. */
  deferredToolsMode?: "additional-tools" | "tool-search";
  toolOptions?: ConvertResponsesToolsOptions;
}

export interface ConvertResponsesToolsOptions {
  strict?: boolean | null;
  supportsStrictMode?: boolean;
  supportsOpenAIGrammarTools?: boolean;
  deferLoading?: boolean;
}

/**
 * The transcript as Responses input items.
 *
 * - Tool call item ids must start with `fc_`, and message ids are at most 64 characters.
 * - Tool calls from a different model drop their item id: OpenAI tracks which item ids were
 *   paired with `rs_*` reasoning items, and omitting the id avoids that pairing validation, as
 *   for cross-provider calls. Ids that do not match the replayed item type are dropped too:
 *   `function_call` ids must be `fc_*` and `custom_tool_call` ids `ctc_*`. Foreign ids normalize
 *   to `fc_*`, and a call switches type when grammar tool support differs.
 */
export function convertResponsesMessages(
  model: Model<"openai-responses" | "azure-openai-responses" | "openai-codex-responses">,
  context: TranscriptContext,
  allowedToolCallProviders: ReadonlySet<string>,
  options?: ConvertResponsesMessagesOptions,
): ResponsesInput {
  const messages: ResponsesInput = [];

  const normalizedContext = resolveTranscript(context, options?.supportsMidConvoSystemMessages);
  const checkpoint = normalizedContext.checkpoint;

  if (checkpoint !== undefined) {
    if (
      checkpoint.provider !== model.provider ||
      checkpoint.api !== model.api ||
      checkpoint.model !== model.id ||
      !Value.Check(CheckpointItemsSchema, checkpoint.data)
    ) {
      throw new Error(`Checkpoint material does not match ${model.provider}/${model.id}`);
    }

    messages.push(...checkpoint.data);
  }

  const loadedToolNames = new Set<string>();

  const normalizeIdPart = (part: string): string => {
    const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
    const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;

    return normalized.replace(/_+$/, "");
  };

  const buildForeignResponsesItemId = (itemId: string): string => {
    const normalized = `fc_${shortHash(itemId)}`;

    return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
  };

  const normalizeToolCallId = (
    id: string,
    _targetModel: Model<"openai-responses" | "azure-openai-responses" | "openai-codex-responses">,
    source: AssistantMessage,
  ): string => {
    if (!allowedToolCallProviders.has(model.provider)) return normalizeIdPart(id);

    if (!id.includes("|")) return normalizeIdPart(id);
    const [callId, itemId] = id.split("|");
    const normalizedCallId = normalizeIdPart(callId);
    const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;

    let normalizedItemId = isForeignToolCall
      ? buildForeignResponsesItemId(itemId)
      : normalizeIdPart(itemId);

    if (!normalizedItemId.startsWith("fc_")) {
      normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
    }

    return `${normalizedCallId}|${normalizedItemId}`;
  };

  const transformedMessages = transformMessages(
    normalizedContext.messages,
    model,
    normalizeToolCallId,
  );

  const transcriptTools = resolveTranscriptTools(
    normalizedContext.messages,
    options?.deferredToolsMode !== undefined,
  );

  const pushToolLoad = (tools: Tool[], seed: string): void => {
    if (tools.length === 0 || options?.deferredToolsMode === undefined) return;

    if (options.deferredToolsMode === "additional-tools") {
      messages.push({
        type: "additional_tools",
        role: "developer",
        tools: convertResponsesTools(tools, options.toolOptions),
      } satisfies ResponsesAdditionalToolsItem);

      return;
    }

    const names = tools.map((tool) => tool.name);
    const callId = `pi_tool_load_${shortHash(`${seed}:${names.join(",")}`)}`;

    messages.push({
      type: "tool_search_call",
      call_id: callId,
      execution: "client",
      status: "completed",
      arguments: { query: names.join(" "), limit: names.length },
    } satisfies ResponseInputItem);
    messages.push({
      type: "tool_search_output",
      call_id: callId,
      execution: "client",
      status: "completed",
      tools: convertResponsesTools(tools, { ...options.toolOptions, deferLoading: true }),
    } satisfies ResponsesToolSearchOutputItem);
  };

  const appendSystemToolAdditions = (message: SystemMessage, seed: string): void => {
    const tools = transcriptTools.anchorsAdditions ? (message.toolsAdded ?? []) : [];

    for (const tool of tools) loadedToolNames.add(tool.name);
    pushToolLoad(tools, seed);
  };

  const includeInitialSystemMessage = options?.includeSystemPrompt ?? true;

  const instructionRole =
    model.reasoning && model.compat?.supportsDeveloperRole !== false ? "developer" : "system";

  let msgIndex = 0;
  let sourceIndex = 0;

  for (const msg of transformedMessages) {
    const isLeadingSystemMessage = sourceIndex++ === 0 && msg.role === "system";

    if (msg.role === "system") {
      if (!isLeadingSystemMessage) appendSystemToolAdditions(msg, `system:${msgIndex}`);

      if (!isLeadingSystemMessage || includeInitialSystemMessage) {
        const text = isLeadingSystemMessage
          ? getSystemMessageText(msg)
          : renderSystemMessageUpdate(msg);

        if (text.length > 0) {
          messages.push({ role: instructionRole, content: sanitizeSurrogates(text) });
        }
      }
    } else if (msg.role === "user") {
      if (!Array.isArray(msg.content)) {
        messages.push({
          role: "user",
          content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }],
        });
      } else {
        const content: ResponseInputContent[] = msg.content.map((item): ResponseInputContent => {
          if (item.type === "text") {
            return {
              type: "input_text",
              text: sanitizeSurrogates(item.text),
            } satisfies ResponseInputText;
          }

          return {
            type: "input_image",
            detail: "auto",
            image_url: `data:${item.mimeType};base64,${item.data}`,
          } satisfies ResponseInputImage;
        });

        if (content.length === 0) continue;
        messages.push({
          role: "user",
          content,
        });
      }
    } else if (msg.role === "assistant") {
      const output: ResponsesInput = [];
      const isSameProviderAndApi = msg.provider === model.provider && msg.api === model.api;
      const isSameModel = isSameProviderAndApi && msg.model === model.id;
      const isDifferentModel = isSameProviderAndApi && msg.model !== model.id;
      let textBlockIndex = 0;

      for (const block of msg.content) {
        if (block.type === "thinking") {
          const reasoningItem: unknown = block.thinkingSignature
            ? JSON.parse(block.thinkingSignature)
            : undefined;

          if (Value.Check(ReplayedReasoningSchema, reasoningItem)) output.push(reasoningItem);
        } else if (block.type === "text") {
          const parsedSignature = parseTextSignature(block.textSignature);

          const fallbackMessageId =
            textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;

          textBlockIndex++;
          let msgId = parsedSignature?.id;

          if (!msgId) {
            msgId = fallbackMessageId;
          } else if (msgId.length > 64) {
            msgId = `msg_${shortHash(msgId)}`;
          }

          output.push({
            type: "message",
            role: "assistant",
            content: [
              { type: "output_text", text: sanitizeSurrogates(block.text), annotations: [] },
            ],
            status: "completed",
            id: msgId,
            phase: parsedSignature?.phase,
          } satisfies ResponseOutputMessage);
        } else if (block.type === "toolCall") {
          const [callId, itemIdRaw] = block.id.split("|");
          const customInputProperty = options?.grammarToolInputProperties?.get(block.name);
          let itemId: string | undefined = itemIdRaw;

          const itemIdPrefix = customInputProperty === undefined ? "fc_" : "ctc_";

          if (isDifferentModel || !itemId?.startsWith(itemIdPrefix)) {
            itemId = undefined;
          }

          const canReplayNamespace =
            isSameModel || options?.deferredTools?.has(block.name) === true;

          const call: ResponseCustomToolCall | ResponseFunctionToolCall =
            customInputProperty === undefined
              ? {
                  type: "function_call",
                  id: itemId,
                  call_id: callId,
                  name: block.name,
                  arguments: JSON.stringify(block.arguments),
                }
              : {
                  type: "custom_tool_call",
                  id: itemId,
                  call_id: callId,
                  name: block.name,
                  input: sanitizeSurrogates(
                    getGrammarToolInput(block.name, block.arguments, customInputProperty),
                  ),
                };

          if (canReplayNamespace && block.namespace !== undefined) {
            call.namespace = block.namespace;
          }

          output.push(call);
        }
      }

      if (output.length === 0) continue;
      messages.push(...output);
    } else if (msg.role === "toolResult") {
      const [callId] = msg.toolCallId.split("|");
      const output = convertToolResultOutput(model, msg.content);

      if (options?.grammarToolInputProperties?.has(msg.toolName)) {
        messages.push({
          type: "custom_tool_call_output",
          call_id: callId,
          output,
        });
      } else {
        messages.push({
          type: "function_call_output",
          call_id: callId,
          output,
        });
      }

      const deferredTools: Tool[] = [];

      for (const name of msg.addedToolNames ?? []) {
        const tool = options?.deferredTools?.get(name);

        if (!tool || loadedToolNames.has(name)) continue;
        loadedToolNames.add(name);
        deferredTools.push(tool);
      }

      pushToolLoad(deferredTools, msg.toolCallId);
    }

    if (!isLeadingSystemMessage) msgIndex++;
  }

  return messages;
}

export function convertResponsesTools(
  tools: readonly Tool[],
  options?: ConvertResponsesToolsOptions,
): ResponsesTool[] {
  const defaultStrict = options?.strict === undefined ? false : options.strict;
  const supportsStrictMode = options?.supportsStrictMode ?? true;
  const supportsOpenAIGrammarTools = options?.supportsOpenAIGrammarTools ?? false;

  return tools.map((tool) => {
    const grammar = resolveGrammarConstrainedSampling(tool, supportsOpenAIGrammarTools);

    if (grammar) {
      const customTool: CustomTool = {
        type: "custom",
        name: tool.name,
        description: tool.description,
        format: {
          type: "grammar",
          syntax: grammar.format,
          definition: grammar.definition,
        },
      };

      if (options?.deferLoading) customTool.defer_loading = true;

      return customTool;
    }

    const constrainedStrict = resolveJsonSchemaStrictSampling(tool, supportsStrictMode);
    const strict = constrainedStrict ?? defaultStrict;

    const functionTool: ResponsesFunctionTool = {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: getJsonSchemaToolParameters(tool, strict === true),
    };

    if (options?.deferLoading) functionTool.defer_loading = true;

    if (supportsStrictMode) {
      functionTool.strict = strict;
    }

    return functionTool;
  });
}
