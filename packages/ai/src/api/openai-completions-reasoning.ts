/**
 * Reasoning replay data on OpenAI-compatible Chat Completions: OpenRouter
 * `reasoning_details`, the raw reasoning fields servers stream, and Copilot's
 * `reasoning_opaque` state.
 */
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const reasoningDetailFields = {
  id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  format: Type.Optional(Type.String()),
  index: Type.Optional(Type.Number()),
};

export const OpenAIReasoningDetailSchema = Type.Union([
  Type.Object({
    ...reasoningDetailFields,
    type: Type.Literal("reasoning.summary"),
    summary: Type.String(),
  }),
  Type.Object({
    ...reasoningDetailFields,
    type: Type.Literal("reasoning.encrypted"),
    data: Type.String(),
  }),
  Type.Object({
    ...reasoningDetailFields,
    type: Type.Literal("reasoning.text"),
    text: Type.String(),
    signature: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  }),
]);

const OpenAIReasoningDetailsSchema = Type.Array(OpenAIReasoningDetailSchema, { minItems: 1 });

export type OpenAIReasoningDetail = Static<typeof OpenAIReasoningDetailSchema>;

type OpenAIEncryptedReasoningDetail = Extract<
  OpenAIReasoningDetail,
  { type: "reasoning.encrypted" }
>;

export function parseOpenAIReasoningDetails(
  signature: string | undefined,
): OpenAIReasoningDetail[] | undefined {
  if (!signature) return undefined;

  try {
    const parsed: unknown = JSON.parse(signature);

    return Value.Check(OpenAIReasoningDetailsSchema, parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function parseLegacyEncryptedReasoningDetail(
  signature: string | undefined,
): OpenAIEncryptedReasoningDetail | undefined {
  if (!signature) return undefined;

  try {
    const parsed: unknown = JSON.parse(signature);

    return Value.Check(OpenAIReasoningDetailSchema, parsed) &&
      parsed.type === "reasoning.encrypted" &&
      parsed.id !== undefined &&
      parsed.id !== null &&
      parsed.id.length > 0 &&
      parsed.data.length > 0
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

function fillMissingCommonReasoningDetailFields(
  target: OpenAIReasoningDetail,
  source: OpenAIReasoningDetail,
): void {
  target.id ??= source.id;
  target.format ||= source.format;
  target.index ??= source.index;
}

export function appendOpenAIReasoningDetail(
  details: OpenAIReasoningDetail[],
  detail: OpenAIReasoningDetail,
): void {
  const lastDetail = details.at(-1);

  if (detail.type === "reasoning.text" && lastDetail?.type === "reasoning.text") {
    lastDetail.text += detail.text;
    lastDetail.signature ||= detail.signature;
    fillMissingCommonReasoningDetailFields(lastDetail, detail);
    return;
  }

  if (detail.type === "reasoning.summary" && lastDetail?.type === "reasoning.summary") {
    lastDetail.summary += detail.summary;
    fillMissingCommonReasoningDetailFields(lastDetail, detail);
    return;
  }

  details.push({ ...detail });
}

const OPENAI_COMPLETIONS_REASONING_FIELDS = [
  "reasoning",
  "reasoning_content",
  "reasoning_text",
] as const;

export type OpenAICompletionsReasoningField = (typeof OPENAI_COMPLETIONS_REASONING_FIELDS)[number];

export const OpenAICompletionsReasoningFieldSchema = Type.Enum(OPENAI_COMPLETIONS_REASONING_FIELDS);

/**
 * Copilot continues a model's reasoning across turns only when the assistant
 * message replays `reasoning_opaque`; it rides in the thinking signature.
 */
export const CopilotReasoningOpaqueSchema = Type.Object({
  reasoning_opaque: Type.String({ minLength: 1 }),
});

export const REASONING_DELTA_SCHEMAS = (
  ["reasoning_content", "reasoning", "reasoning_text"] as const
).map((field) => ({ field, schema: Type.Object({ [field]: Type.String({ minLength: 1 }) }) }));

export const ReasoningDetailsDeltaSchema = Type.Object({
  reasoning_details: Type.Array(Type.Unknown()),
});

export function parseCopilotReasoningOpaque(signature: string | undefined): string | undefined {
  if (!signature) return undefined;

  try {
    const parsed: unknown = JSON.parse(signature);

    return Value.Check(CopilotReasoningOpaqueSchema, parsed) ? parsed.reasoning_opaque : undefined;
  } catch {
    return undefined;
  }
}
