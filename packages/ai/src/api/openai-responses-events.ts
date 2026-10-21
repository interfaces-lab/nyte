/**
 * The Responses stream events the shared processor acts on, as TypeBox schemas. Both the
 * OpenAI SDK stream and Codex's raw frames are checked against them once, at the processor's
 * ingress; events of other types, or missing the fields read, are skipped.
 */
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";

/** llama.cpp omits `output_index` from every event, so it is optional. */
const OutputIndex = Type.Optional(Type.Number());

const ItemId = Type.Optional(Type.String());

const Namespace = Type.Optional(Type.String());

const ReasoningItemSchema = Type.Object({
  type: Type.Literal("reasoning"),
  id: Type.String(),
  summary: Type.Optional(Type.Array(Type.Object({ text: Type.String() }))),
  content: Type.Optional(Type.Array(Type.Object({ text: Type.String() }))),
  encrypted_content: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const MessageItemSchema = Type.Object({
  type: Type.Literal("message"),
  id: ItemId,
  phase: Type.Optional(
    Type.Union([Type.Literal("commentary"), Type.Literal("final_answer"), Type.Null()]),
  ),
  content: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Object({ type: Type.Literal("output_text"), text: Type.String() }),
        Type.Object({ type: Type.Literal("refusal"), refusal: Type.String() }),
      ]),
    ),
  ),
});

const FunctionCallItemSchema = Type.Object({
  type: Type.Literal("function_call"),
  id: ItemId,
  call_id: Type.String(),
  name: Type.String(),
  arguments: Type.Optional(Type.String()),
  namespace: Namespace,
});

const CustomToolCallItemSchema = Type.Object({
  type: Type.Literal("custom_tool_call"),
  id: ItemId,
  call_id: Type.String(),
  name: Type.String(),
  input: Type.Optional(Type.String()),
  namespace: Namespace,
});

const OutputItemSchema = Type.Union([
  ReasoningItemSchema,
  MessageItemSchema,
  FunctionCallItemSchema,
  CustomToolCallItemSchema,
]);

export type ResponsesOutputItem = Static<typeof OutputItemSchema>;

/** A reasoning item in a terminal response's output, for backfilling its encrypted content. */
export const TerminalReasoningItemSchema = Type.Object({
  type: Type.Literal("reasoning"),
  id: Type.String(),
  encrypted_content: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

/** A stored reasoning item: what the processor serialized into a thinking signature. */
export const StoredReasoningItemSchema = Type.Object({
  type: Type.Literal("reasoning"),
  encrypted_content: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

const ResponseStatusSchema = Type.Union([
  Type.Literal("completed"),
  Type.Literal("failed"),
  Type.Literal("in_progress"),
  Type.Literal("cancelled"),
  Type.Literal("queued"),
  Type.Literal("incomplete"),
]);

export type ResponsesStatus = Static<typeof ResponseStatusSchema>;

/** A service tier as the Responses API reports it; GPT-6 reports Fast mode as `fast`. */
export const ServiceTierSchema = Type.Union([
  Type.Literal("auto"),
  Type.Literal("default"),
  Type.Literal("flex"),
  Type.Literal("scale"),
  Type.Literal("priority"),
  Type.Literal("fast"),
  Type.Literal("ultrafast"),
  Type.Null(),
]);

export type ResponsesServiceTier = Static<typeof ServiceTierSchema>;

/**
 * The terminal response metadata the processor reads. Usage and service tier stay unknown
 * here: the finalizer validates usage itself so an invalid count fails as a usage error, and an
 * unrecognized tier is ignored rather than dropping the terminal event.
 */
const TerminalResponseSchema = Type.Object({
  id: Type.Optional(Type.String()),
  status: Type.Optional(ResponseStatusSchema),
  incomplete_details: Type.Optional(
    Type.Union([Type.Object({ reason: Type.Optional(Type.String()) }), Type.Null()]),
  ),
  error: Type.Optional(
    Type.Union([
      Type.Object({
        code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        message: Type.Optional(Type.String()),
      }),
      Type.Null(),
    ]),
  ),
  output: Type.Optional(Type.Array(Type.Unknown())),
  usage: Type.Optional(Type.Unknown()),
  service_tier: Type.Optional(Type.Unknown()),
});

export type ResponsesTerminalResponse = Static<typeof TerminalResponseSchema>;

function deltaEvent<const T extends string>(type: T) {
  return Type.Object({ type: Type.Literal(type), output_index: OutputIndex, delta: Type.String() });
}

const ResponsesStreamEventSchema = Type.Union([
  Type.Object({
    type: Type.Literal("response.created"),
    response: Type.Object({ id: Type.Optional(Type.String()) }),
  }),
  Type.Object({
    type: Type.Union([
      Type.Literal("response.output_item.added"),
      Type.Literal("response.output_item.done"),
    ]),
    output_index: OutputIndex,
    item: OutputItemSchema,
  }),
  deltaEvent("response.reasoning_summary_text.delta"),
  Type.Object({
    type: Type.Literal("response.reasoning_summary_part.done"),
    output_index: OutputIndex,
  }),
  deltaEvent("response.reasoning_text.delta"),
  deltaEvent("response.output_text.delta"),
  deltaEvent("response.refusal.delta"),
  deltaEvent("response.function_call_arguments.delta"),
  Type.Object({
    type: Type.Literal("response.function_call_arguments.done"),
    output_index: OutputIndex,
    arguments: Type.String(),
  }),
  deltaEvent("response.custom_tool_call_input.delta"),
  Type.Object({
    type: Type.Literal("response.custom_tool_call_input.done"),
    output_index: OutputIndex,
    input: Type.String(),
  }),
  Type.Object({
    type: Type.Union([
      Type.Literal("response.completed"),
      Type.Literal("response.incomplete"),
      Type.Literal("response.failed"),
    ]),
    response: TerminalResponseSchema,
  }),
  Type.Object({
    type: Type.Literal("error"),
    code: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    message: Type.Optional(Type.String()),
  }),
]);

/** Checks a raw event; compiled once because it runs for every streamed delta. */
export const ResponsesStreamEventCheck = Compile(ResponsesStreamEventSchema);
