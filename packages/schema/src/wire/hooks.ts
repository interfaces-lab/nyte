import { Type } from "typebox";
import type { ModelRequest, SubmitDraft, Submission, ToolCall } from "../hooks.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { ConfigurationPatchType, ConfigurationType } from "./configuration.ts";
import { idSchema } from "./ids.ts";
import { JsonType, withJson } from "./json.ts";
import { DeliveryType, MessageSourceType, UserContentType } from "./messages.ts";
import { ModelRefType, ThinkingType } from "./models.ts";
import { nullable } from "./nullable.ts";
import { ToolClassType } from "./tools.ts";

export const SubmissionType = Type.Object({
  content: UserContentType,
  source: MessageSourceType,
  delivery: DeliveryType,
  configuration: nullable(Type.Union([ConfigurationType, ConfigurationPatchType])),
  replace: nullable(idSchema<"message">()),
});

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

export const ToolCallType = Type.Object({
  call: idSchema<"call">(),
  name: Type.String(),
  args: JsonType,
  class: ToolClassType,
});

export const SubmitDraftType = Type.Object({
  content: UserContentType,
  delivery: DeliveryType,
  session: idSchema<"session">(),
});

export const SubmissionSchema: Schema<Submission> = standard(withJson(SubmissionType));

export const ModelRequestSchema: Schema<ModelRequest> = standard(withJson(ModelRequestType));

export const ToolCallSchema: Schema<ToolCall> = standard(withJson(ToolCallType));

export const SubmitDraftSchema: Schema<SubmitDraft> = standard(SubmitDraftType);
