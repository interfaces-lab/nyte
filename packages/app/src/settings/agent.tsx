import type { ReactElement } from "react";
import { ModelPicker } from "../chat/composer/model-picker.tsx";
import { modelRefFor, selectedModelOption } from "../chat/composer/model-picker-state.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { useCatalog, useSetPreference } from "../data/catalog.ts";
import { SettingsRow, SettingsSection } from "./rows.tsx";

export function AgentSettings(): ReactElement {
  const catalog = useCatalog();
  const setPreference = useSetPreference();
  const saved = useSetting(preferences.modelSettings);
  const selected = selectedModelOption(catalog.data?.models ?? [], catalog.data?.defaults?.model);
  const listed = catalog.data?.models.some((option) => option.listed) ?? false;

  return (
    <SettingsSection description="Applies to chats started after the change">
      <SettingsRow
        title="Model"
        controlWidth="wide"
        description={
          catalog.isError
            ? "Couldn't load the model catalog. Try again"
            : catalog.data !== undefined && !listed
              ? "Connect a provider in Providers to choose one"
              : "New chats start on this model. Switch per chat from the composer"
        }
      >
        <ModelPicker
          catalog={catalog.data}
          current={selected?.option}
          thinkingLevel={selected === undefined ? undefined : saved[selected.option.key]?.thinking}
          fast={selected?.fast === true}
          loading={catalog.isPending || setPreference.isPending}
          onChange={(change) => {
            if (setPreference.isPending) return;
            setPreference.mutate(modelRefFor(change.option, change.fast));
          }}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
