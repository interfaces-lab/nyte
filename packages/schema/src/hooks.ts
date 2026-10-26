import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { DeliveryType, MessageSourceType, UserContentType } from "./messages.ts";
import type { Message as ModelMessage } from "./model/message.ts";
import { ModelRefType, ThinkingType } from "./models.ts";
import type { ModelRef, Usage } from "./models.ts";
import type { Json } from "./json.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import type { ToolInfo } from "./sessions.ts";
import { ToolClassType } from "./tools.ts";
import { nullable } from "./wire/nullable.ts";

export const SubmissionType = Type.Object({
  content: UserContentType,
  source: MessageSourceType,
  delivery: DeliveryType,
  replace: nullable(idSchema<"message">()),
});

export type Submission = Decoded<typeof SubmissionType>;

export const ModelRequestType = Type.Object({
  model: ModelRefType,
  thinking: ThinkingType,
  step: Type.Enum(["assistant", "compaction", "summary"]),
  attempt: Type.Number(),
  options: Type.Object({
    sampling: Type.Record(Type.String(), JsonType),
    headers: Type.Record(Type.String(), Type.String()),
  }),
});

export type ModelRequest = Decoded<typeof ModelRequestType>;

export const ToolCallType = Type.Object({
  call: idSchema<"call">(),
  name: Type.String(),
  args: JsonType,
  class: ToolClassType,
});

export type ToolCall = Decoded<typeof ToolCallType>;

export const SubmitDraftType = Type.Object({
  content: UserContentType,
  delivery: DeliveryType,
  session: nullable(idSchema<"session">()),
});

/** A client's draft before it is sent; `session` is null for a draft that starts a chat. */
export type SubmitDraft = Decoded<typeof SubmitDraftType>;

export const SubmissionSchema: Schema<Submission> = standard(withJson(SubmissionType));

export const ModelRequestSchema: Schema<ModelRequest> = standard(withJson(ModelRequestType));

export const ToolCallSchema: Schema<ToolCall> = standard(withJson(ToolCallType));

export const SubmitDraftSchema: Schema<SubmitDraft> = standard(SubmitDraftType);

export type Transcript = {
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolInfo[];
};

export type CompactionPlan = {
  readonly model: ModelRef;
  readonly reason: "manual" | "threshold" | "overflow";
  readonly instructions: string | null;
  readonly tokensBefore: number;
  readonly summarise: readonly ModelMessage[];
  readonly keep: readonly ModelMessage[];
  readonly result:
    | { readonly kind: "summary"; readonly text: string }
    | {
        readonly kind: "material";
        readonly provider: string;
        readonly api: string;
        readonly model: string;
        readonly data: Json;
        readonly usage: Usage | null;
      }
    | null;
};

export type Decision<Value> =
  | { readonly action: "continue" }
  | { readonly action: "modify"; readonly value: Value }
  | { readonly action: "reject"; readonly reason: string }
  | { readonly action: "error"; readonly message: string };
