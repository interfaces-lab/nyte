import type { Plugin } from "./types.ts";
import type { PluginInfo } from "@nyte-ai/protocol";

export type PluginSourceInfo = Omit<Extract<PluginInfo, { status: "active" }>, "id" | "status">;

const sources = new WeakMap<Plugin, PluginSourceInfo>();

export function withPluginSource<T extends Plugin>(plugin: T, source: PluginSourceInfo): T {
  sources.set(plugin, source);
  return plugin;
}

export function pluginSource(plugin: Plugin): PluginSourceInfo | undefined {
  return sources.get(plugin);
}
