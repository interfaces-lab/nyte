import { Type } from "typebox";
import type { Failure } from "./errors.ts";
import type { Message as ModelMessage } from "./model/message.ts";
import type { ModelRef, Thinking, Usage } from "./models.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";

export const PromptOverrideType = Type.Union([
  Type.Object({
    kind: Type.Literal("layer"),
    text: Type.String(),
    order: Type.Optional(Type.Number()),
  }),
  Type.Object({ kind: Type.Literal("replace"), text: Type.String() }),
]);

export type PromptOverride = Decoded<typeof PromptOverrideType>;

export const PromptOverrideSchema: Schema<PromptOverride> = standard(PromptOverrideType);

export type ModelRequestInput<T = string> = {
  readonly model: ModelRef;
  readonly system?: string;
  readonly messages: readonly ModelMessage[];
  readonly thinking?: Thinking;
  readonly output?: Schema<T>;
  readonly maxOutput?: number;
  readonly signal?: AbortSignal;
};

export type ModelRequestOutcome<T = string> =
  | {
      readonly kind: "ok";
      readonly value: T;
      readonly usage: Usage;
      readonly stop: "end" | "length";
    }
  | { readonly kind: "refused"; readonly reason: string }
  | { readonly kind: "failed"; readonly failure: Failure };
