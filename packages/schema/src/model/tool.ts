import type { TSchema } from "typebox";
import type { JsonValue, Message } from "./message.ts";
import type { Api, ProviderId } from "./model.ts";

export type GrammarFormat = "openai_lark" | "openai_regex";

export type GrammarVariants = Partial<Record<GrammarFormat, string>>;

export type ConstrainedSamplingConfig =
  | {
      type: "json_schema";
      strict: "prefer" | "require";
    }
  | {
      type: "grammar";
      variants: GrammarVariants;
    };

export type ToolKind =
  | "read"
  | "edit"
  | "delete"
  | "move"
  | "search"
  | "execute"
  | "fetch"
  | "think"
  | "other";

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
  kind?: ToolKind;
  constrainedSampling?: false | ConstrainedSamplingConfig;
}

export interface ToolReference {
  name: string;
}

export interface ProviderCheckpointMaterial {
  type: "provider";
  provider: ProviderId;
  api: Api;
  model: string;
  data: JsonValue;
}

export interface Context {
  systemPrompt?: string;
  checkpoint?: ProviderCheckpointMaterial;
  messages: Message[];
  tools?: Tool[];
}
