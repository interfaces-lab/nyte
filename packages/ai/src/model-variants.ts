/**
 * Fast mode as a model of its own. Each eligible catalog model gets a
 * `<id>-fast` sibling that names the base and the mode, so a session selects
 * fast the way it selects any model and the choice travels as a model ref.
 *
 * Two identities, one rule. The sibling is the selected identity: config,
 * catalog, availability, spans. The base is the provider identity: what a
 * request is sent as (`providerRequest`, applied where `Models` and the
 * one-shot calls hand a request over) and what every answer, checkpoint and
 * stored message is recorded under, so history stays one model's history
 * whether a session runs fast or not. Anything that compares history with
 * the selected model compares through `providerIdentity`. The sibling keeps
 * the base's rates; the API prices the premium once, from the mode.
 */
import { getFastModeCostMultiplier } from "./model-pricing.ts";
import type { Api, Model } from "./types.ts";

export const FAST_MODEL_SUFFIX = "-fast";

export function fastModelId(base: string): string {
  return `${base}${FAST_MODEL_SUFFIX}`;
}

/** Advertises fast mode on an API whose premium is known. */
export function supportsFastMode(model: Model<Api>): boolean {
  return (
    model.variant === undefined &&
    model.modes?.includes("fast") === true &&
    getFastModeCostMultiplier(model) !== undefined
  );
}

/** The catalog with a fast sibling after each eligible model; a real `<id>-fast` keeps its place. */
export function withFastVariants(models: readonly Model<Api>[]): readonly Model<Api>[] {
  const ids = new Set(models.map((model) => model.id));

  return models.flatMap((model) =>
    supportsFastMode(model) && !ids.has(fastModelId(model.id))
      ? [
          model,
          {
            ...model,
            id: fastModelId(model.id),
            name: `${model.name} Fast`,
            variant: { mode: "fast", base: model.id },
          },
        ]
      : [model],
  );
}

/** The model a variant stands for; a base model is its own. */
export function baseModel<M extends Model<Api>>(model: M): M {
  return model.variant === undefined
    ? model
    : { ...model, id: model.variant.base, variant: undefined };
}

/** What the provider calls this model: the identity its answers, checkpoints and history carry. */
export function providerIdentity(model: Pick<Model<Api>, "provider" | "api" | "id" | "variant">): {
  readonly provider: Model<Api>["provider"];
  readonly api: Api;
  readonly model: string;
} {
  return { provider: model.provider, api: model.api, model: model.variant?.base ?? model.id };
}

/** What leaves for a provider: a variant goes as its base with its mode requested. */
export function providerRequest<M extends Model<Api>, O extends { fast?: boolean } | undefined>(
  model: M,
  options: O,
): { readonly model: M; readonly options: O } {
  if (model.variant?.mode !== "fast") return { model, options };

  return { model: baseModel(model), options: { ...options, fast: true } };
}
