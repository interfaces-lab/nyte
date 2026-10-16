import { Type } from "typebox";
import type {
  ContextView,
  LoginMethod,
  ModelAccount,
  ModelCatalogView,
  ModelInfo,
  ModelRef,
  ProviderUsage,
  Thinking,
  Usage,
} from "../models.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { idSchema } from "./ids.ts";
import { nullable } from "./nullable.ts";

export const ModelRefType = Type.Object({ provider: Type.String(), id: Type.String() });

export const ThinkingType = Type.Enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

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

export const ContextViewType = Type.Object({
  tokens: Type.Number(),
  window: Type.Number(),
  lastRequest: nullable(UsageType),
});

export const LoginMethodType = Type.Union([
  Type.Object({ kind: Type.Literal("oauth") }),
  Type.Object({ kind: Type.Literal("key") }),
]);

const PROVIDER_LIMITS = Type.Array(
  Type.Object({
    label: Type.String(),
    used: Type.Number(),
    limit: Type.Number(),
    resetsAt: nullable(Type.Number()),
  }),
);

export const ModelAccountType = Type.Object({
  provider: Type.String(),
  id: Type.String(),
  label: Type.String(),
  method: LoginMethodType,
  active: Type.Boolean(),
});

export const ProviderUsageType = Type.Object({
  provider: Type.String(),
  name: Type.String(),
  account: nullable(ModelAccountType),
  state: Type.Union([
    Type.Object({
      kind: Type.Literal("ready"),
      limits: PROVIDER_LIMITS,
      observedAt: Type.Number(),
      stale: Type.Boolean(),
      error: nullable(Type.String()),
    }),
    Type.Object({
      kind: Type.Literal("unavailable"),
      reason: Type.Enum(["unsupported", "unconfigured", "failed"]),
      message: Type.String(),
    }),
  ]),
});

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

export const ModelCatalogViewType = Type.Object({
  generation: idSchema<"catalog-generation">(),
  default: nullable(ModelRefType),
  providers: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      credential: Type.Enum(["unknown", "missing", "configured", "verified", "failed"]),
      methods: Type.Array(LoginMethodType),
      limits: PROVIDER_LIMITS,
      models: Type.Array(ModelInfoType),
    }),
  ),
});

export const ModelRefSchema: Schema<ModelRef> = standard(ModelRefType);

export const ThinkingSchema: Schema<Thinking> = standard(ThinkingType);

export const UsageSchema: Schema<Usage> = standard(UsageType);

export const ContextViewSchema: Schema<ContextView> = standard(ContextViewType);

export const LoginMethodSchema: Schema<LoginMethod> = standard(LoginMethodType);

export const ModelAccountSchema: Schema<ModelAccount> = standard(ModelAccountType);

export const ProviderUsageSchema: Schema<ProviderUsage> = standard(ProviderUsageType);

export const ModelInfoSchema: Schema<ModelInfo> = standard(ModelInfoType);

export const ModelCatalogViewSchema: Schema<ModelCatalogView> = standard(ModelCatalogViewType);
