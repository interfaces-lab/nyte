/**
 * Per-plugin key-value storage on top of session facts. Keys are namespaced
 * by plugin id so two plugins cannot see each other's state.
 */
/** The session fact a plugin's storage key resolves to. One place builds this string. */
export function pluginFactKey(pluginId: string, key: string): string {
  return `plugin:${pluginId}:${key}`;
}
