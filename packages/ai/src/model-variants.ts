import { MODEL_MODES } from "@nyte-ai/schema/model";
import type { ModelMode } from "@nyte-ai/schema/model";
import { getFastModeCostMultiplier } from "./model-pricing.ts";
import type { Api, Model } from "./types.ts";

const MODE_NAMES: Readonly<Record<ModelMode, string>> = { fast: "Fast", daybreak: "Daybreak" };

/** The id of `base` with `modes` on, such as `<base>-fast` or `<base>-fast-daybreak`. */
export function variantModelId(base: string, modes: readonly ModelMode[]): string {
  return [base, ...modes].join("-");
}

/** The switches a base model offers, in `MODEL_MODES` order; fast only where its price is known. */
export function supportedModes(model: Model<Api>): readonly ModelMode[] {
  if (model.variant !== undefined) return [];

  return MODEL_MODES.filter(
    (mode) =>
      model.modes?.includes(mode) === true &&
      (mode !== "fast" || getFastModeCostMultiplier(model) !== undefined),
  );
}

/**
 * The catalog with a sibling after each model for every combination of its switches.
 * A real model that already has a variant's id keeps its place instead.
 */
export function withModeVariants(models: readonly Model<Api>[]): readonly Model<Api>[] {
  const ids = new Set(models.map((model) => model.id));

  return models.flatMap((model) => [
    model,
    ...modeCombinations(supportedModes(model))
      .filter((modes) => !ids.has(variantModelId(model.id, modes)))
      .map((modes): Model<Api> => ({
        ...model,
        id: variantModelId(model.id, modes),
        name: [model.name, ...modes.map((mode) => MODE_NAMES[mode])].join(" "),
        variant: { modes: [...modes], base: model.id },
      })),
  ]);
}

function modeCombinations(modes: readonly ModelMode[]): readonly (readonly ModelMode[])[] {
  return Array.from({ length: 2 ** modes.length - 1 }, (_, index) =>
    modes.filter((_, bit) => Math.floor((index + 1) / 2 ** bit) % 2 === 1),
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

export function providerRequest<
  M extends Model<Api>,
  O extends { fast?: boolean; daybreak?: boolean } | undefined,
>(model: M, options: O): { readonly model: M; readonly options: O } {
  if (model.variant === undefined) return { model, options };
  const modes = model.variant.modes;

  return {
    model: baseModel(model),
    options: {
      ...options,
      ...(modes.includes("fast") ? { fast: true } : {}),
      ...(modes.includes("daybreak") ? { daybreak: true } : {}),
    },
  };
}
