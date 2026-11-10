import type { ReactElement } from "react";
import { ModelPicker } from "../chat/composer/model-picker.tsx";
import { modelRefFor, selectedModelOption } from "../chat/composer/model-picker-state.ts";
import { hostSetting, preferences, useSetting } from "../preferences/index.ts";
import { useCatalog, useSetPreference } from "../data/catalog.ts";
import { NumberRow, SelectRow, SettingsRow, SettingsSection, SwitchRow } from "./rows.tsx";

const CACHE_WARMING = [
  { value: "off", label: "Off" },
  { value: "streaming", label: "While running" },
  { value: "idle", label: "Also when idle" },
] as const;

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
      <SwitchRow
        setting={hostSetting("autoCompaction")}
        title="Automatic compaction"
        description="Summarize older turns when a chat nears the model's context limit"
      />
      <NumberRow
        setting={hostSetting("compactionKeepRecentTokens")}
        title="Recent context kept"
        description="Tokens kept word for word when older turns are summarized"
        min={5_000}
        max={100_000}
        step={5_000}
      />
      <SelectRow
        setting={hostSetting("cacheWarming")}
        title="Prompt cache warming"
        description="Refresh the prompt cache before it expires, when that is expected to save money"
        options={CACHE_WARMING}
      />
    </SettingsSection>
  );
}
