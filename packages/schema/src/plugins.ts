import type { Failure, Message as ModelMessage } from "./model/message.ts";
import type { ModelRef, Thinking, Usage } from "./models.ts";
import type { Schema } from "./schema.ts";

export type PromptOverride =
  | { readonly kind: "layer"; readonly text: string; readonly order?: number }
  | { readonly kind: "replace"; readonly text: string };

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
