import { Type } from "typebox";
import { idSchema } from "./ids.ts";
import { MODEL_MODES } from "./model/model.ts";
import type { ModelMode } from "./model/model.ts";
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
  /** The model under each set of switches the user can turn on, such as fast mode; switches combine. */
  variants: Type.Array(
    Type.Object({ modes: Type.Array(Type.Enum([...MODEL_MODES])), ref: ModelRefType }),
  ),
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

/** The switches `info` offers, in `MODEL_MODES` order. */
export function availableModes(info: ModelInfo): readonly ModelMode[] {
  return MODEL_MODES.filter((mode) =>
    info.variants.some((variant) => variant.modes.includes(mode)),
  );
}

/** The model to run for `info` with `modes` on; a switch `info` doesn't offer is ignored. */
export function modelWithModes(info: ModelInfo, modes: readonly ModelMode[]): ModelRef {
  const wanted = availableModes(info).filter((mode) => modes.includes(mode));

  return (
    info.variants.find(
      (variant) =>
        variant.modes.length === wanted.length &&
        variant.modes.every((mode) => wanted.includes(mode)),
    )?.ref ?? info.ref
  );
}

/** The switches `ref` turns on when it is `info` or one of its variants, else null. */
export function selectedModes(info: ModelInfo, ref: ModelRef): readonly ModelMode[] | null {
  if (info.ref.provider === ref.provider && info.ref.id === ref.id) return [];

  return (
    info.variants.find(
      (variant) => variant.ref.provider === ref.provider && variant.ref.id === ref.id,
    )?.modes ?? null
  );
}

export const ModelListingType = Type.Enum(["shown", "hidden", "favorite"]);

export type ModelListing = Decoded<typeof ModelListingType>;

export const ModelCatalogViewType = Type.Object({
  generation: idSchema<"catalog-generation">(),
  default: nullable(ModelRefType),
  providers: Type.Array(
    Type.Object({
      id: Type.String(),
      name: Type.String(),
      /** An agent found installed on the host, such as Claude Code: its models run its own loop and are never picked for the user. */
      agent: Type.Boolean(),
      credential: Type.Enum(["unknown", "missing", "configured", "verified", "failed"]),
      methods: Type.Array(LoginMethodType),
      limits: PROVIDER_LIMITS,
      models: Type.Array(ModelInfoType),
      listings: Type.Record(Type.String(), Type.Enum(["hidden", "favorite"])),
    }),
  ),
});

export type ModelCatalogView = Decoded<typeof ModelCatalogViewType>;

export function availableModels(catalog: ModelCatalogView): readonly ModelInfo[] {
  return catalog.providers.flatMap((provider) => (signedIn(provider) ? provider.models : []));
}

export function enabledModels(catalog: ModelCatalogView): readonly ModelInfo[] {
  return catalog.providers.flatMap((provider) =>
    signedIn(provider)
      ? provider.models.filter((model) => provider.listings[model.ref.id] !== "hidden")
      : [],
  );
}

/** The models and variants `name` can mean: an exact provider/id, else an exact id, else the ones that hold all its words with the fewest extra. */
export function matchModels(models: readonly ModelInfo[], name: string): readonly ModelRef[] {
  const refs = models.flatMap((info) => [info.ref, ...info.variants.map((variant) => variant.ref)]);
  const exact = refs.filter((ref) => `${ref.provider}/${ref.id}` === name);

  if (exact.length > 0) return exact;
  const ids = refs.filter((ref) => ref.id === name);

  return ids.length > 0 ? ids : closestModels(refs, name);
}

function signedIn(provider: ModelCatalogView["providers"][number]): boolean {
  return provider.credential !== "missing" && provider.credential !== "failed";
}

function closestModels(refs: readonly ModelRef[], name: string): readonly ModelRef[] {
  const wanted = modelWords(name);

  if (!wanted.some((word) => /[a-z]/u.test(word))) return [];

  const held = refs.flatMap((ref) => {
    const words = modelWords(`${ref.provider}/${ref.id}`);

    return wanted.every((word) => countWord(words, word) >= countWord(wanted, word))
      ? [{ ref, extra: modelWords(ref.id).length }]
      : [];
  });

  const fewest = Math.min(...held.map((entry) => entry.extra));

  return held.flatMap((entry) => (entry.extra === fewest ? [entry.ref] : []));
}

function modelWords(source: string): readonly string[] {
  return source.toLowerCase().match(/[a-z]+|\d+/gu) ?? [];
}

function countWord(words: readonly string[], word: string): number {
  return words.filter((entry) => entry === word).length;
}

export const ModelRefSchema: Schema<ModelRef> = standard(ModelRefType);

export const ThinkingSchema: Schema<Thinking> = standard(ThinkingType);

export const UsageSchema: Schema<Usage> = standard(UsageType);

export const ContextViewSchema: Schema<ContextView> = standard(ContextViewType);

export const LoginMethodSchema: Schema<LoginMethod> = standard(LoginMethodType);

export const ModelAccountSchema: Schema<ModelAccount> = standard(ModelAccountType);

export const ProviderUsageSchema: Schema<ProviderUsage> = standard(ProviderUsageType);

export const ModelInfoSchema: Schema<ModelInfo> = standard(ModelInfoType);

export const ModelCatalogViewSchema: Schema<ModelCatalogView> = standard(ModelCatalogViewType);
