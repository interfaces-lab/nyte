import type { JsonRecord } from "./wire.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { matchesRecord, messageSchema } from "./wire.ts";
import {
  getDeclaredTools,
  getInitialSystemMessage,
  hasToolRedefinitions,
  renderSystemMessageUpdate,
} from "@nyte-ai/ai";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  SimpleStreamOptions,
  SystemMessage,
  TextContent,
  Tool,
  ToolResultMessage,
} from "@nyte-ai/ai";
import type { NativeContentBlock, NativeFrame, NativeMessage } from "./wire.ts";

export const TOOL_PREFIX = "mcp__nyte__";

const NATIVE_REPLAY_DIAGNOSTIC = "claude-code.native-assistant.v1";

export const NATIVE_TOOL_CHANGES_BETA = "mid-conversation-tool-changes-2026-07-01";

const DEFERRED_TOOL_PLACEHOLDER = {
  name: "__nyte_deferred_placeholder__",
  description: "Reserved placeholder. Never available. Never call this.",
  input_schema: { type: "object", properties: {}, required: [] },
  defer_loading: true,
};

export interface NativeSystemInjection {
  beforeAssistant: number | null;
  content: Array<JsonRecord>;
}

export interface NativeTranscriptPlan {
  requestTools: Array<JsonRecord>;
  systemInjections: NativeSystemInjection[];
}

interface ReplayCarrier {
  version: 1;
  message: NativeMessage;
  projection: AssistantProjection;
  initialUserPrefix?: unknown[];
  initialSystemMessages?: unknown[];
}

interface AssistantProjection {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: JsonRecord }>;
}

function sanitizeSurrogates(text: string): string {
  return text.replace(/[\uD800-\uDFFF]/gu, "\uFFFD");
}

function assistantProjection(message: AssistantMessage): AssistantProjection {
  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  const toolCalls = message.content
    .filter((block) => block.type === "toolCall")
    .map((block) => ({ id: block.id, name: block.name, input: structuredClone(block.arguments) }));

  return { text, toolCalls };
}

const projectionSchema = Type.Object({
  text: Type.String(),
  toolCalls: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      input: Type.Record(Type.String(), Type.Unknown()),
    }),
  ),
});

const replayCarrierSchema = Type.Object({
  version: Type.Literal(1),
  message: messageSchema,
  projection: projectionSchema,
  initialUserPrefix: Type.Optional(Type.Array(Type.Unknown())),
  initialSystemMessages: Type.Optional(Type.Array(Type.Unknown())),
});

function replayCarrier(message: AssistantMessage): ReplayCarrier | undefined {
  const diagnostic = message.diagnostics?.find((item) => item.type === NATIVE_REPLAY_DIAGNOSTIC);
  const candidate = diagnostic?.details?.carrier;

  return Value.Check(replayCarrierSchema, candidate) ? candidate : undefined;
}

function replayMetadata(
  messages: Message[],
  key: "initialUserPrefix" | "initialSystemMessages",
): unknown[] | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];

    if (message?.role !== "assistant") continue;
    const value = replayCarrier(message)?.[key];

    if (value) return structuredClone(value);
  }

  return undefined;
}

export function getInitialUserPrefix(messages: Message[]): unknown[] | undefined {
  return replayMetadata(messages, "initialUserPrefix");
}

export function getInitialSystemMessages(messages: Message[]): unknown[] | undefined {
  return replayMetadata(messages, "initialSystemMessages");
}

function imageBlock(block: ImageContent): JsonRecord {
  return {
    type: "image",
    source: { type: "base64", media_type: block.mimeType, data: block.data },
  };
}

function userContent(content: string | (TextContent | ImageContent)[]): unknown[] {
  if (typeof content === "string")
    return content ? [{ type: "text", text: sanitizeSurrogates(content) }] : [];

  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: sanitizeSurrogates(block.text) }
      : imageBlock(block),
  );
}

function toolResultContent(message: ToolResultMessage): string | unknown[] {
  const hasImages = message.content.some((block) => block.type === "image");

  if (!hasImages) {
    return sanitizeSurrogates(
      message.content
        .filter((block): block is TextContent => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
    );
  }

  return message.content.map((block) =>
    block.type === "text"
      ? { type: "text", text: sanitizeSurrogates(block.text) }
      : imageBlock(block),
  );
}

function canonicalAssistantContent(message: AssistantMessage): NativeContentBlock[] {
  const blocks: NativeContentBlock[] = [];

  for (const block of message.content) {
    if (block.type === "text" && block.text.trim()) {
      blocks.push({ type: "text", text: sanitizeSurrogates(block.text) });
    } else if (block.type === "thinking" && block.thinking.trim() && block.thinkingSignature) {
      if (block.redacted) {
        blocks.push({ type: "redacted_thinking", data: block.thinkingSignature });
      } else {
        blocks.push({
          type: "thinking",
          thinking: sanitizeSurrogates(block.thinking),
          signature: block.thinkingSignature,
        });
      }
    } else if (block.type === "toolCall") {
      blocks.push({
        type: "tool_use",
        id: block.id,
        name: `${TOOL_PREFIX}${block.name}`,
        input: structuredClone(block.arguments),
      });
    }
  }

  return blocks;
}

function assistantContent(message: AssistantMessage): NativeContentBlock[] {
  const carrier = replayCarrier(message);

  if (
    carrier &&
    JSON.stringify(assistantProjection(message)) === JSON.stringify(carrier.projection)
  ) {
    return structuredClone(carrier.message.content);
  }

  if (carrier) {
    return canonicalAssistantContent({
      ...message,
      content: message.content.filter((block) => block.type !== "thinking"),
    });
  }

  return canonicalAssistantContent(message);
}

export function prepareFrames(messages: Message[]): NativeFrame[] {
  const frames: NativeFrame[] = [];

  for (const message of messages) {
    if (message.role === "system") continue;

    let role: "user" | "assistant";
    let blocks: unknown[];

    if (message.role === "user") {
      role = "user";
      blocks = userContent(message.content);
    } else if (message.role === "assistant") {
      role = "assistant";
      blocks = assistantContent(message);
    } else {
      role = "user";
      blocks = [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: toolResultContent(message),
          is_error: message.isError,
        },
      ];
    }

    if (blocks.length === 0) continue;
    const previous = frames.at(-1);

    if (role === "user" && previous?.type === "user") {
      previous.message.content.push(...blocks);
    } else {
      frames.push({ type: role, message: { role, content: blocks } });
    }
  }

  const final = frames.at(-1);

  if (!final || final.type !== "user" || final.message.content.length === 0) {
    throw new Error("Claude Code history must end in a non-empty user or tool-result message");
  }

  for (let index = 0; index < frames.length - 1; index++) {
    const frame = frames[index];

    if (frame?.type === "user") frame.shouldQuery = false;
  }

  return frames;
}

function withoutNullVariant(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutNullVariant);

  if (!matchesRecord(schema)) return schema;

  const output: JsonRecord = {};

  for (const [key, value] of Object.entries(schema)) output[key] = withoutNullVariant(value);

  if (Array.isArray(output.type) && output.type.includes("null")) {
    const remaining = output.type.filter((value) => value !== "null");
    output.type = remaining.length === 1 ? remaining[0] : remaining;
  }

  if (Array.isArray(output.anyOf)) {
    const nonNull = output.anyOf.filter(
      (branch) => !(matchesRecord(branch) && branch.type === "null"),
    );

    if (nonNull.length === 1 && nonNull.length !== output.anyOf.length) {
      const replacement = nonNull[0];
      delete output.anyOf;

      if (replacement && typeof replacement === "object") Object.assign(output, replacement);
    }
  }

  return output;
}

function normalizeInputSchema(schema: unknown): JsonRecord {
  const normalized = withoutNullVariant(schema);

  if (!matchesRecord(normalized)) throw new Error("Tool input schema must be an object");

  for (const key of ["oneOf", "allOf", "anyOf"]) delete normalized[key];

  if (!normalized.type) normalized.type = "object";

  if (
    normalized.type === "object" &&
    (!normalized.properties || typeof normalized.properties !== "object")
  ) {
    normalized.properties = {};
  }

  return normalized;
}

export interface ToolManifestEntry {
  name: string;
  description: string;
  inputSchema: JsonRecord;
}

export function prepareTools(tools: Tool[]): {
  manifest: ToolManifestEntry[];
  nativeTools: Array<JsonRecord>;
  names: Set<string>;
} {
  const names = new Set<string>();
  const manifest: ToolManifestEntry[] = [];
  const nativeTools: Array<JsonRecord> = [];

  for (const tool of tools) {
    if (!/^[A-Za-z0-9_-]{1,50}$/u.test(tool.name) || names.has(tool.name)) {
      throw new Error(
        "Claude Code tool names must be unique ASCII identifiers of at most 50 characters",
      );
    }

    names.add(tool.name);
    const schema = normalizeInputSchema(tool.parameters);
    manifest.push({ name: tool.name, description: tool.description, inputSchema: schema });
    nativeTools.push({
      name: `${TOOL_PREFIX}${tool.name}`,
      description: tool.description,
      input_schema: schema,
    });
  }

  return { manifest, nativeTools, names };
}

function nativeSystemBlocks(message: SystemMessage): Array<JsonRecord> {
  const blocks: Array<JsonRecord> = [];
  const text = renderSystemMessageUpdate(message);

  if (text) blocks.push({ type: "text", text: sanitizeSurrogates(text) });

  for (const tool of message.toolsRemoved ?? []) {
    blocks.push({
      type: "tool_removal",
      tool: { type: "tool_reference", name: `${TOOL_PREFIX}${tool.name}` },
    });
  }

  for (const tool of message.toolsAdded ?? []) {
    blocks.push({
      type: "tool_addition",
      tool: { type: "tool_reference", name: `${TOOL_PREFIX}${tool.name}` },
    });
  }

  return blocks;
}

export function prepareNativeTranscript(
  messages: Message[],
  supported: boolean,
): NativeTranscriptPlan | undefined {
  const initial = getInitialSystemMessage(messages);
  const initialTools = initial?.toolsAdded ?? [];

  if (!supported || initialTools.length === 0 || hasToolRedefinitions(messages)) return undefined;

  const declared = getDeclaredTools(messages);
  const prepared = prepareTools(declared);

  const nativeByName = new Map(
    prepared.nativeTools.map((tool) => [String(tool.name).slice(TOOL_PREFIX.length), tool]),
  );

  const initialNames = new Set(initialTools.map((tool) => tool.name));

  const initialNative = initialTools.map((tool) => {
    const native = nativeByName.get(tool.name);

    if (native === undefined) throw new Error(`Missing declared tool ${tool.name}`);

    return structuredClone(native);
  });

  const final = initialNative.at(-1);

  if (final) final.cache_control = { type: "ephemeral", ttl: "1h" };

  const laterNative = declared
    .filter((tool) => !initialNames.has(tool.name))
    .map((tool) => ({ ...structuredClone(nativeByName.get(tool.name)), defer_loading: true }));

  const systemInjections: NativeSystemInjection[] = [];
  let pending: Array<Array<JsonRecord>> = [];
  let assistantOrdinal = 0;

  const flush = (beforeAssistant: number | null) => {
    for (const content of pending) systemInjections.push({ beforeAssistant, content });
    pending = [];
  };

  for (let index = 1; index < messages.length; index++) {
    const message = messages[index];

    if (message === undefined) continue;

    if (message.role === "system") {
      const blocks = nativeSystemBlocks(message);

      if (blocks.length) pending.push(blocks);
    } else if (message.role === "assistant" && assistantContent(message).length > 0) {
      flush(assistantOrdinal);
      assistantOrdinal += 1;
    }
  }

  flush(null);

  return {
    requestTools: [...initialNative, structuredClone(DEFERRED_TOOL_PLACEHOLDER), ...laterNative],
    systemInjections,
  };
}

export function buildExtraBody(
  nativeTools: Array<JsonRecord>,
  options: SimpleStreamOptions | undefined,
  adaptive: boolean,
): JsonRecord {
  const body: JsonRecord = { tools: nativeTools };

  if (options?.maxTokens !== undefined) body.max_tokens = options.maxTokens;

  if (options?.reasoning) {
    if (adaptive) body.thinking = { type: "adaptive" };
    body.output_config = {
      effort: options.reasoning === "minimal" ? "low" : options.reasoning,
    };
  } else {
    body.thinking = { type: "disabled" };
    body.context_management = { edits: [] };
  }

  return body;
}

export function makeReplayDiagnostic(
  message: NativeMessage,
  output: AssistantMessage,
  initialUserPrefix?: unknown[],
  initialSystemMessages?: unknown[],
) {
  return {
    type: NATIVE_REPLAY_DIAGNOSTIC,
    timestamp: Date.now(),
    details: {
      carrier: {
        version: 1,
        message: structuredClone(message),
        projection: assistantProjection(output),
        ...(initialUserPrefix ? { initialUserPrefix: structuredClone(initialUserPrefix) } : {}),
        ...(initialSystemMessages
          ? { initialSystemMessages: structuredClone(initialSystemMessages) }
          : {}),
      },
    },
  };
}
