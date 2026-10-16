import type { ModelRef, Thinking } from "./models.ts";
import type { Json } from "./primitives.ts";

export type ConfigurationPatch = {
  readonly model?: ModelRef;
  readonly thinking?: Thinking | null;
  readonly agent?: string | null;
  readonly settings?: Readonly<Record<string, Json>>;
};

export type Configuration = {
  readonly kind: "exact";
  readonly model: ModelRef;
  readonly thinking: Thinking;
  readonly agent: string | null;
  readonly settings: Readonly<Record<string, Json>>;
  readonly settingsVersion: string;
};
