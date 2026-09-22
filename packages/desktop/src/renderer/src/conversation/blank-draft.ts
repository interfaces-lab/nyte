import type { DesktopCatalog } from "../../../shared/ipc.ts";
import type { BlankViewState } from "../layout/session-view-state.ts";
import type { ModelPickerChange } from "./model-picker.tsx";

/**
 * The selection this draft sends with. A pick the catalog no longer lists is
 * dropped for the default: a pane carries a choice forward, not a dead one.
 * While the catalog is still loading, the pick stands; nothing can judge it yet.
 */
export function draftConfiguration(
  catalog: DesktopCatalog | undefined,
  configuration: DesktopCatalog["defaults"] | undefined,
): DesktopCatalog["defaults"] | undefined {
  if (catalog === undefined) return configuration;

  if (configuration === undefined) return catalog.defaults;

  const listed = catalog.models.some(
    (option) =>
      option.provider === configuration.model.provider && option.id === configuration.model.id,
  );

  return listed ? configuration : catalog.defaults;
}

/** Apply picker choices to the draft that will create the session. */
export function updateDraftModel({
  state,
  defaults,
  change,
}: {
  readonly state: BlankViewState;
  readonly defaults: DesktopCatalog["defaults"] | undefined;
  readonly change: ModelPickerChange;
}): BlankViewState {
  const selected = state.configuration ?? defaults;

  switch (change.kind) {
    case "model":
      return {
        ...state,
        configuration: {
          model: { provider: change.option.provider, id: change.option.id },
          thinkingLevel: change.thinkingLevel,
        },
      };
    case "thinking":
      return selected === undefined
        ? state
        : { ...state, configuration: { ...selected, thinkingLevel: change.thinkingLevel } };
    case "fast": {
      const fastSettings = new Set(state.fastSettings);

      if (change.enabled) fastSettings.add(change.settingId);
      else fastSettings.delete(change.settingId);

      return { ...state, configuration: selected, fastSettings };
    }

    default: {
      const _exhaustive: never = change;

      return _exhaustive;
    }
  }
}
