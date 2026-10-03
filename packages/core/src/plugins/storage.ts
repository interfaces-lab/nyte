/**
 * Per-plugin key-value storage on top of session facts. Keys are namespaced
 * by plugin id so two plugins cannot see each other's state.
 */
import type { JsonValue } from "@nyte-ai/schema";
import type { SettingDefinition } from "./types.ts";

/** The session fact a plugin's storage key resolves to. One place builds this string. */
export function pluginFactKey(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}

/** The choice a stored value names, or the default when it names none. */
export function storedChoice<Id extends string>(
  setting: SettingDefinition<Id>,
  stored: JsonValue | undefined,
): Id {
  return setting.choices.find((choice) => choice.id === stored)?.id ?? setting.default;
}
