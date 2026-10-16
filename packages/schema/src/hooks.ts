import type { Configuration, ConfigurationPatch } from "./configuration.ts";
import type { CallId, MessageId, SessionId } from "./ids.ts";
import type { Delivery, MessageSource, UserContent } from "./messages.ts";
import type { Message as ModelMessage } from "./model/message.ts";
import type { ModelRef, Thinking, Usage } from "./models.ts";
import type { Json } from "./primitives.ts";
import type { ToolInfo } from "./sessions.ts";
import type { ToolClass } from "./tools.ts";

export type Submission = {
  readonly content: UserContent;
  readonly source: MessageSource;
  readonly delivery: Delivery;
  readonly configuration: Configuration | ConfigurationPatch | null;
  readonly replace: MessageId | null;
};

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

export type ModelRequest = {
  readonly model: ModelRef;
  readonly thinking: Thinking;
  readonly step: "assistant" | "compaction" | "summary";
  readonly attempt: number;
  readonly options: {
    readonly sampling: Readonly<Record<string, Json>>;
    readonly headers: Readonly<Record<string, string>>;
  };
};

export type ToolCall = {
  readonly call: CallId;
  readonly name: string;
  readonly args: Json;
  readonly class: ToolClass;
};

export type SubmitDraft = {
  readonly content: UserContent;
  readonly delivery: Delivery;
  readonly session: SessionId;
};

export type Decision<Value> =
  | { readonly action: "continue" }
  | { readonly action: "modify"; readonly value: Value }
  | { readonly action: "reject"; readonly reason: string }
  | { readonly action: "error"; readonly message: string };
