import type { DesktopCatalog } from "../../../shared/ipc.ts";
import type { BlankViewState } from "../layout/session-view-state.ts";
import type { ModelPickerChange } from "./model-picker.tsx";

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
