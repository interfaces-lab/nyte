import { Type, type Static } from "typebox";

// Decode only the fields this adapter consumes. Other provider fields remain intact.
const TokenCount = Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]));
const UsageSchema = Type.Object({
  input_tokens: TokenCount,
  output_tokens: TokenCount,
  cache_read_input_tokens: TokenCount,
  cache_creation_input_tokens: TokenCount,
  cache_creation: Type.Optional(
    Type.Union([Type.Object({ ephemeral_1h_input_tokens: TokenCount }), Type.Null()]),
  ),
  output_tokens_details: Type.Optional(
    Type.Union([Type.Object({ thinking_tokens: TokenCount }), Type.Null()]),
  ),
  speed: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ContentBlockSchema = Type.Union([
  Type.Object({
    type: Type.Literal("text"),
    text: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  Type.Object({
    type: Type.Literal("thinking"),
    thinking: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    signature: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
  Type.Object({ type: Type.Literal("redacted_thinking"), data: Type.String() }),
  Type.Object({
    type: Type.Literal("tool_use"),
    id: Type.String(),
    name: Type.String(),
    input: Type.Optional(Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()])),
  }),
]);

const ContentDeltaSchema = Type.Union([
  Type.Object({ type: Type.Literal("text_delta"), text: Type.String() }),
  Type.Object({ type: Type.Literal("thinking_delta"), thinking: Type.String() }),
  Type.Object({ type: Type.Literal("input_json_delta"), partial_json: Type.String() }),
  Type.Object({ type: Type.Literal("signature_delta"), signature: Type.String() }),
]);

const ContentIndex = Type.Integer({ minimum: 0 });
export const AnthropicEventSchema = Type.Union([
  Type.Object({
    type: Type.Literal("message_start"),
    message: Type.Object({ id: Type.String(), model: Type.String(), usage: UsageSchema }),
  }),
  Type.Object({
    type: Type.Literal("message_delta"),
    delta: Type.Object({
      stop_reason: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      stop_details: Type.Optional(
        Type.Union([
          Type.Object({ explanation: Type.Optional(Type.Union([Type.String(), Type.Null()])) }),
          Type.Null(),
        ]),
      ),
    }),
    usage: Type.Optional(Type.Union([UsageSchema, Type.Null()])),
  }),
  Type.Object({ type: Type.Literal("message_stop") }),
  Type.Object({
    type: Type.Literal("content_block_start"),
    index: ContentIndex,
    content_block: ContentBlockSchema,
  }),
  Type.Object({
    type: Type.Literal("content_block_delta"),
    index: ContentIndex,
    delta: ContentDeltaSchema,
  }),
  Type.Object({ type: Type.Literal("content_block_stop"), index: ContentIndex }),
]);
export type AnthropicEvent = Static<typeof AnthropicEventSchema>;
export const AnthropicEventTypeSchema = Type.Index(AnthropicEventSchema, ["type"]);

// Unknown block variants are forward-compatible. Malformed *known* variants must
// not fall through this alternative, so derive its exclusions from the schemas above.
export const IgnoredAnthropicEventSchema = Type.Union([
  Type.Object({
    type: Type.Literal("content_block_start"),
    index: ContentIndex,
    content_block: Type.Object({
      type: Type.String({ not: Type.Index(ContentBlockSchema, ["type"]) }),
    }),
  }),
  Type.Object({
    type: Type.Literal("content_block_delta"),
    index: ContentIndex,
    delta: Type.Object({
      type: Type.String({ not: Type.Index(ContentDeltaSchema, ["type"]) }),
    }),
  }),
]);
