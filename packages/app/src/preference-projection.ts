import type { ModelThinkingLevel } from "@nyte-ai/schema";
import type { DesktopCatalog, DesktopModelOption, PreferenceChange } from "./bridge.ts";
import type { ModelPickerChange } from "./conversation/model-picker.tsx";
import { modelRefFor } from "./conversation/model-picker-state.ts";

/** The whole setup a picker change leaves behind becomes what the next new chat starts with. */
export function pickerDefaults(
  setup: {
    readonly model: DesktopModelOption | undefined;
    readonly thinkingLevel: ModelThinkingLevel | undefined;
    /** The setup selects the model's fast sibling. */
    readonly fast: boolean;
  },
  change: ModelPickerChange,
): PreferenceChange {
  const model = setup.model === undefined ? undefined : modelRefFor(setup.model, setup.fast);

  switch (change.kind) {
    case "model":
      return {
        kind: "defaults",
        model: { provider: change.option.provider, id: change.option.id },
        thinkingLevel: change.thinkingLevel,
      };
    case "thinking":
      return { kind: "defaults", model, thinkingLevel: change.thinkingLevel };
    case "fast":
      return {
        kind: "defaults",
        model: setup.model === undefined ? undefined : modelRefFor(setup.model, change.enabled),
        thinkingLevel: setup.thinkingLevel,
      };
    default: {
      const _exhaustive: never = change;

      return _exhaustive;
    }
  }
}

/** Predict the selected controls; the host still chooses any replacement default. */
export function projectPreference(
  catalog: DesktopCatalog,
  change: PreferenceChange,
): DesktopCatalog {
  if (change.kind === "defaults") {
    if (catalog.defaults === undefined) return catalog;

    return {
      ...catalog,
      defaults: {
        model: change.model ?? catalog.defaults.model,
        thinkingLevel: change.thinkingLevel ?? catalog.defaults.thinkingLevel,
      },
    };
  }

  const providers =
    change.kind === "provider"
      ? catalog.providers.map((provider) =>
          provider.id === change.provider ? { ...provider, enabled: change.enabled } : provider,
        )
      : catalog.providers;

  const provider = providers.find((item) => item.id === change.provider);

  const models = catalog.models.map((model) => {
    if (model.provider !== change.provider) return model;

    const hidden =
      change.kind === "models" && change.ids.includes(model.id) ? change.hidden : model.hidden;

    return {
      ...model,
      hidden,
      listed: !hidden && provider?.enabled === true && provider.connection.kind !== "disconnected",
    };
  });

  return { ...catalog, providers, models };
}
