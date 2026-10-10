import { Type } from "typebox";
import type {
  ContextView,
  LoginMethod,
  ModelCatalogView,
  ModelInfo,
  ModelRef,
  Thinking,
  Usage,
} from "../models.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { idSchema } from "./ids.ts";
import { nullable } from "./nullable.ts";

/** The TypeBox schema of a `ModelRef`. */
export const ModelRefType = Type.Object({ provider: Type.String(), id: Type.String() });

/** The TypeBox schema of a `Thinking` level. */
export const ThinkingType = Type.Enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** The TypeBox schema of a `Usage`. */
export const UsageType = Type.Object({
  input: Type.Number(),
  output: Type.Number(),
  cacheRead: Type.Number(),
  cacheWrite: Type.Number(),
  reasoning: nullable(Type.Number()),
  total: Type.Number(),
  cost: Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
    total: Type.Number(),
  }),
});

/** The TypeBox schema of a `ContextView`. */
export const ContextViewType = Type.Object({
  tokens: Type.Number(),
  window: Type.Number(),
  lastRequest: nullable(UsageType),
});

/** The TypeBox schema of a `LoginMethod`. */
export const LoginMethodType = Type.Union([
  Type.Object({ kind: Type.Literal("oauth") }),
  Type.Object({ kind: Type.Literal("key") }),
]);

/** The TypeBox schema of a `ModelInfo`. */
export const ModelInfoType = Type.Object({
  ref: ModelRefType,
  name: Type.String(),
  reasoning: Type.Boolean(),
  thinking: Type.Array(ThinkingType),
  fast: nullable(ModelRefType),
  contextWindow: Type.Number(),
  compactAt: Type.Number(),
  maxOutput: Type.Number(),
  input: Type.Array(Type.Enum(["text", "image"])),
  cost: Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
  }),
});

/** The TypeBox schema of a `ModelCatalogView`. */
export const ModelCatalogViewType = Type.Object({
  generation: idSchema<"catalog-generation">(),
  default: nullable(ModelRefType),
  providers: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      credential: Type.Enum(["missing", "configured", "verified", "failed"]),
      methods: Type.Array(LoginMethodType),
      limits: Type.Array(
        Type.Object({
          label: Type.String(),
          used: Type.Number(),
          limit: Type.Number(),
          resetsAt: nullable(Type.Number()),
        }),
      ),
      models: Type.Array(ModelInfoType),
    }),
  ),
});

/** Validates a `ModelRef`. */
export const ModelRefSchema: Schema<ModelRef> = standard(ModelRefType);

/** Validates a `Thinking` level. */
export const ThinkingSchema: Schema<Thinking> = standard(ThinkingType);

/** Validates a `Usage`. */
export const UsageSchema: Schema<Usage> = standard(UsageType);

/** Validates a `ContextView`. */
export const ContextViewSchema: Schema<ContextView> = standard(ContextViewType);

/** Validates a `LoginMethod`. */
export const LoginMethodSchema: Schema<LoginMethod> = standard(LoginMethodType);

/** Validates a `ModelInfo`. */
export const ModelInfoSchema: Schema<ModelInfo> = standard(ModelInfoType);

/** Validates a `ModelCatalogView`. */
export const ModelCatalogViewSchema: Schema<ModelCatalogView> = standard(ModelCatalogViewType);
