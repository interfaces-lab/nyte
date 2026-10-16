import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Static } from "typebox";

export const recordSchema = Type.Record(Type.String(), Type.Unknown());

const usageSchema = Type.Object({
  input_tokens: Type.Number(),
  output_tokens: Type.Number(),
  cache_read_input_tokens: Type.Optional(Type.Number()),
  cache_creation_input_tokens: Type.Optional(Type.Number()),
  cache_creation: Type.Optional(
    Type.Object({ ephemeral_1h_input_tokens: Type.Optional(Type.Number()) }),
  ),
  output_tokens_details: Type.Optional(
    Type.Object({ thinking_tokens: Type.Optional(Type.Number()) }),
  ),
});

const contentSchema = Type.Union([
  Type.Object({ type: Type.Literal("text"), text: Type.String() }),
  Type.Object({
    type: Type.Literal("thinking"),
    thinking: Type.String(),
    signature: Type.Optional(Type.String()),
  }),
  Type.Object({ type: Type.Literal("redacted_thinking"), data: Type.String() }),
  Type.Object({
    type: Type.Literal("tool_use"),
    id: Type.String(),
    name: Type.String(),
    input: recordSchema,
  }),
]);

const messageSchema = Type.Intersect([
  recordSchema,
  Type.Object({
    id: Type.Optional(Type.String()),
    role: Type.Literal("assistant"),
    content: Type.Array(contentSchema),
    usage: Type.Optional(usageSchema),
    stop_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    stop_sequence: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
]);

const streamEventSchema = Type.Union([
  Type.Object({ type: Type.Literal("message_start"), message: messageSchema }),
  Type.Object({
    type: Type.Literal("content_block_start"),
    index: Type.Integer({ minimum: 0 }),
    content_block: contentSchema,
  }),
  Type.Object({
    type: Type.Literal("content_block_delta"),
    index: Type.Integer({ minimum: 0 }),
    delta: Type.Union([
      Type.Object({ type: Type.Literal("text_delta"), text: Type.String() }),
      Type.Object({ type: Type.Literal("thinking_delta"), thinking: Type.String() }),
      Type.Object({ type: Type.Literal("signature_delta"), signature: Type.String() }),
      Type.Object({ type: Type.Literal("input_json_delta"), partial_json: Type.String() }),
    ]),
  }),
  Type.Object({ type: Type.Literal("content_block_stop"), index: Type.Integer({ minimum: 0 }) }),
  Type.Object({
    type: Type.Literal("message_delta"),
    delta: Type.Object({
      stop_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      stop_sequence: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    }),
    usage: Type.Optional(Type.Partial(usageSchema)),
  }),
  Type.Object({ type: Type.Literal("message_stop") }),
  Type.Object({
    type: Type.Literal("error"),
    error: Type.Optional(
      Type.Object({ type: Type.Optional(Type.String()), message: Type.Optional(Type.String()) }),
    ),
  }),
]);

const outputEventSchema = Type.Union([
  Type.Object({
    type: Type.Literal("assistant"),
    message: messageSchema,
    error: Type.Optional(Type.Unknown()),
  }),
  Type.Object({
    type: Type.Literal("result"),
    subtype: Type.Optional(Type.String()),
    is_error: Type.Optional(Type.Boolean()),
    num_turns: Type.Optional(Type.Number()),
    usage: Type.Optional(usageSchema),
    total_cost_usd: Type.Optional(Type.Number()),
    modelUsage: Type.Optional(recordSchema),
  }),
  Type.Object({ type: Type.Literal("stream_event"), event: streamEventSchema }),
  Type.Object({
    type: Type.Literal("rate_limit_event"),
    rate_limit_info: Type.Optional(
      Type.Object({
        status: Type.Optional(Type.String()),
        rateLimitType: Type.Optional(Type.String()),
        resetsAt: Type.Optional(Type.Number()),
        isUsingOverage: Type.Optional(Type.Boolean()),
        overageStatus: Type.Optional(Type.String()),
        overageDisabledReason: Type.Optional(Type.String()),
      }),
    ),
  }),
  Type.Object({ type: Type.Literal("control_response"), response: recordSchema }),
]);

const requestMessageSchema = Type.Object({
  role: Type.Optional(Type.String()),
  content: Type.Optional(Type.Unknown()),
});

const requestMessagesSchema = Type.Array(requestMessageSchema);

const requestSchema = Type.Intersect([
  recordSchema,
  Type.Object({ messages: requestMessagesSchema, system: Type.Optional(Type.Unknown()) }),
]);

export type JsonRecord = Static<typeof recordSchema>;

export type NativeUsage = Static<typeof usageSchema>;

export type NativeContentBlock = Static<typeof contentSchema>;

export type NativeMessage = Static<typeof messageSchema>;

export type AnthropicStreamEvent = Static<typeof streamEventSchema>;

export type NativeOutputEvent = Static<typeof outputEventSchema>;

export type NativeResult = Extract<NativeOutputEvent, { type: "result" }>;

export type NativeFrame = {
  type: "user" | "assistant";
  message: { role: "user" | "assistant"; content: unknown[] };
  shouldQuery?: false;
};

export function isRecord(value: unknown): value is JsonRecord {
  return Value.Check(recordSchema, value);
}

export function parseRecord(text: string): JsonRecord {
  const value: unknown = JSON.parse(text);

  if (!isRecord(value)) throw new Error("Expected a JSON object");

  return value;
}

export function isNativeMessage(value: unknown): value is NativeMessage {
  return Value.Check(messageSchema, value);
}

export function parseStreamEvent(text: string): AnthropicStreamEvent | undefined {
  const value: unknown = JSON.parse(text);

  if (isRecord(value) && value.type === "ping") return undefined;

  if (!Value.Check(streamEventSchema, value)) throw new Error("Invalid Anthropic stream event");

  return value;
}

export function parseOutputEvent(text: string): NativeOutputEvent | undefined {
  const value = parseRecord(text);

  if (
    !["assistant", "result", "stream_event", "rate_limit_event", "control_response"].includes(
      String(value.type),
    )
  )
    return undefined;

  if (!Value.Check(outputEventSchema, value)) throw new Error("Invalid Claude Code output event");

  return value;
}

export function parseRequest(body: Buffer) {
  const value: unknown = JSON.parse(body.toString("utf8"));

  if (!Value.Check(requestSchema, value)) throw new Error("Invalid Claude Code request");

  return value;
}

export function parseRequestMessages(value: unknown) {
  if (!Value.Check(requestMessagesSchema, value))
    throw new Error("Invalid Claude Code replay messages");

  return value;
}
