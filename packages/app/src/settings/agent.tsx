import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { NewChatsSection } from "../chrome/models-settings.tsx";
import { hostSetting } from "../preferences/index.ts";
import { useCatalog } from "../queries.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { NumberRow, SelectRow, SettingsSection, SwitchRow } from "./rows.tsx";

const CACHE_WARMING = [
  { value: "off", label: "Off" },
  { value: "streaming", label: "While running" },
  { value: "idle", label: "Also when idle" },
] as const;

export function AgentSettings(): ReactElement {
  const catalog = useCatalog();
  const defaults = catalog.data?.defaults;

  return (
    <>
      {catalog.data !== undefined && defaults !== undefined && (
        <NewChatsSection catalog={catalog.data} defaults={defaults} />
      )}
      {catalog.isError && (
        <p role="alert" {...props(settingsPatterns.sectionDescription)}>
          Couldn&rsquo;t load the model catalog. Try again.
        </p>
      )}
      <SettingsSection title="Context" description="Applies to chats started after the change">
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
    </>
  );
}
