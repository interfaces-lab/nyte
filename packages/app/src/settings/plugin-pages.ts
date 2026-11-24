import type { HostView, SettingInfo } from "@nyte-ai/sdk";
import { namesSettingsSection, showsSettingsSection } from "../settings-sections/sections.ts";
import type { SettingsSection } from "../settings-sections/sections.ts";

type PluginInfo = HostView["plugins"][number];

/** Plugin settings on one page, grouped by the plugin that owns them, in the order plugins loaded. */
export interface PluginGroup {
  readonly owner: string;
  readonly settings: readonly SettingInfo[];
}

export interface PlacedSettings {
  /** What plugins added to each of the app's own pages. */
  readonly preset: ReadonlyMap<SettingsSection, readonly PluginGroup[]>;
  /** The pages plugins named themselves, by title, in the order first named. */
  readonly custom: ReadonlyMap<string, readonly PluginGroup[]>;
}

/**
 * Where each plugin setting shows in Settings, read from the setting's `page`:
 *
 * - a name of one of this app's pages that it shows: on that page;
 * - any other text: on a page of its own under that title, shared by every setting naming it;
 * - nothing, from a plugin you installed: under General;
 * - nothing, from a plugin the app ships: nowhere here, since the app draws those itself.
 *
 * A preset page this client doesn't show sends its settings to General. Only host settings with a
 * field are placed.
 */
export function placePluginSettings(
  plugins: readonly PluginInfo[],
  settings: readonly SettingInfo[],
): PlacedSettings {
  const preset = new Map<SettingsSection, PluginGroup[]>();
  const custom = new Map<string, PluginGroup[]>();
  const installed = new Set(
    plugins.flatMap((plugin) =>
      plugin.source === "user" || plugin.source === "project" ? [plugin.id] : [],
    ),
  );

  const place = <Key>(pages: Map<Key, PluginGroup[]>, key: Key, setting: SettingInfo): void => {
    const groups = pages.get(key) ?? [];
    const group = groups.find((entry) => entry.owner === setting.owner);

    pages.set(
      key,
      group === undefined
        ? [...groups, { owner: setting.owner, settings: [setting] }]
        : groups.map((entry) =>
            entry === group ? { ...entry, settings: [...entry.settings, setting] } : entry,
          ),
    );
  };

  for (const setting of settings) {
    const drawsField =
      (setting.choices ?? []).length > 0 ||
      setting.secret === true ||
      setting.schema.type === "boolean" ||
      setting.schema.type === "string" ||
      setting.schema.type === "number" ||
      setting.schema.type === "integer";

    if (setting.scope !== "host" || !drawsField) continue;

    if (setting.page === undefined) {
      if (installed.has(setting.owner)) place(preset, "general", setting);

      continue;
    }

    if (namesSettingsSection(setting.page)) {
      place(preset, showsSettingsSection(setting.page) ? setting.page : "general", setting);

      continue;
    }

    place(custom, setting.page, setting);
  }

  return { preset, custom };
}
