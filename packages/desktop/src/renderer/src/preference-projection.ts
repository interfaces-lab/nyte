import type { DesktopCatalog, PreferenceChange } from "../../shared/ipc.ts";

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
