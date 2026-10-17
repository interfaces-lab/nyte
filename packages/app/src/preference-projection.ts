import type { ModelRef } from "@nyte-ai/sdk";
import type { ModelThinkingLevel } from "@nyte-ai/schema/model";
import type { DesktopModelOption } from "./catalog.ts";
import type { ModelPickerChange } from "./conversation/model-picker.tsx";
import { modelRefFor } from "./conversation/model-picker-state.ts";

export function pickerDefaults(
  setup: {
    readonly model: DesktopModelOption | undefined;
    readonly thinkingLevel: ModelThinkingLevel | undefined;
    readonly fast: boolean;
  },
  change: ModelPickerChange,
): ModelRef | undefined {
  switch (change.kind) {
    case "model":
      return { provider: change.option.provider, id: change.option.id };
    case "thinking":
      return setup.model === undefined ? undefined : modelRefFor(setup.model, setup.fast);
    case "fast":
      return setup.model === undefined ? undefined : modelRefFor(setup.model, change.enabled);
    default: {
      const _exhaustive: never = change;

      return _exhaustive;
    }
  }
}
