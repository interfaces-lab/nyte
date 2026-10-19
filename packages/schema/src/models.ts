import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export const ModelRefType = Type.Object({ provider: Type.String(), id: Type.String() });

export type ModelRef = Decoded<typeof ModelRefType>;

export const ThinkingType = Type.Enum(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

export type Thinking = Decoded<typeof ThinkingType>;

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

export type Usage = Decoded<typeof UsageType>;

export const ContextViewType = Type.Object({
  tokens: Type.Number(),
  window: Type.Number(),
  lastRequest: nullable(UsageType),
});

export type ContextView = Decoded<typeof ContextViewType>;

export const LoginMethodType = Type.Union([
  Type.Object({ kind: Type.Literal("oauth") }),
  Type.Object({ kind: Type.Literal("key") }),
]);

export type LoginMethod = Decoded<typeof LoginMethodType>;

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

export type ModelAccount = Decoded<typeof ModelAccountType>;

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

export type ProviderUsage = Decoded<typeof ProviderUsageType>;

/**
 * What a model's runtime does around a turn, for clients to read instead of
 * its provider id: `steer` when a message sent mid-turn reaches it before the
 * turn ends (otherwise it waits for the turn). The inputs it reads are
 * `ModelInfo.input`.
 */
export const ModelCapabilitiesType = Type.Object({ steer: Type.Boolean() });

export type ModelCapabilities = Decoded<typeof ModelCapabilitiesType>;

export const ModelInfoType = Type.Object({
  ref: ModelRefType,
  name: Type.String(),
  reasoning: Type.Boolean(),
  thinking: Type.Array(ThinkingType),
  /** The level a chat on this model thinks at when it names none: in the catalog, the level last chosen for this model while it still accepts it, else its lowest level above off. */
  defaultThinking: ThinkingType,
  fast: nullable(ModelRefType),
  contextWindow: Type.Number(),
  compactAt: Type.Number(),
  maxOutput: Type.Number(),
  input: Type.Array(Type.Enum(["text", "image"])),
  capabilities: ModelCapabilitiesType,
  cost: Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    cacheRead: Type.Number(),
    cacheWrite: Type.Number(),
  }),
});

export type ModelInfo = Decoded<typeof ModelInfoType>;

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

export type ModelCatalogView = Decoded<typeof ModelCatalogViewType>;

export const ModelRefSchema: Schema<ModelRef> = standard(ModelRefType);

export const ThinkingSchema: Schema<Thinking> = standard(ThinkingType);

export const UsageSchema: Schema<Usage> = standard(UsageType);

export const ContextViewSchema: Schema<ContextView> = standard(ContextViewType);

export const LoginMethodSchema: Schema<LoginMethod> = standard(LoginMethodType);

export const ModelAccountSchema: Schema<ModelAccount> = standard(ModelAccountType);

export const ProviderUsageSchema: Schema<ProviderUsage> = standard(ProviderUsageType);

export const ModelInfoSchema: Schema<ModelInfo> = standard(ModelInfoType);

export const ModelCatalogViewSchema: Schema<ModelCatalogView> = standard(ModelCatalogViewType);
