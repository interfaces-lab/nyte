import { standard } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/core";
import type { HostView } from "@nyte-ai/sdk";
import { Value } from "typebox/value";
import { DEFAULT_DESKTOP_SETTINGS, DESKTOP_SETTING_SCHEMAS } from "./desktop-settings.ts";
import type { DesktopSettings } from "./desktop-settings.ts";

export const desktopSettingsPlugin = {
  id: "desktop",
  contribute: {
    settings: [
      {
        id: "desktop.keepAwake",
        label: "Keep awake while working",
        schema: standard(DESKTOP_SETTING_SCHEMAS.keepAwake),
        default: DEFAULT_DESKTOP_SETTINGS.keepAwake,
        scope: "host",
      },
      {
        id: "desktop.terminalShell",
        label: "Terminal shell",
        schema: standard(DESKTOP_SETTING_SCHEMAS.terminalShell),
        default: DEFAULT_DESKTOP_SETTINGS.terminalShell,
        scope: "host",
      },
      {
        id: "desktop.blockAds",
        label: "Block ads",
        schema: standard(DESKTOP_SETTING_SCHEMAS.blockAds),
        default: DEFAULT_DESKTOP_SETTINGS.blockAds,
        scope: "host",
      },
      {
        id: "desktop.adblockAllowedHosts",
        label: "Shield paused on",
        schema: standard(DESKTOP_SETTING_SCHEMAS.adblockAllowedHosts),
        default: [],
        scope: "host",
      },
      {
        id: "desktop.upgradeToHttps",
        label: "Upgrade to HTTPS",
        schema: standard(DESKTOP_SETTING_SCHEMAS.upgradeToHttps),
        default: DEFAULT_DESKTOP_SETTINGS.upgradeToHttps,
        scope: "host",
      },
    ],
  },
} satisfies Plugin;

export function desktopSettings(view: Pick<HostView, "settings">): DesktopSettings {
  const value = (key: keyof DesktopSettings) =>
    view.settings.find((setting) => setting.id === `desktop.${key}`)?.value;

  const keepAwake = value("keepAwake");
  const terminalShell = value("terminalShell");
  const blockAds = value("blockAds");
  const adblockAllowedHosts = value("adblockAllowedHosts");
  const upgradeToHttps = value("upgradeToHttps");

  return {
    keepAwake: Value.Check(DESKTOP_SETTING_SCHEMAS.keepAwake, keepAwake)
      ? keepAwake
      : DEFAULT_DESKTOP_SETTINGS.keepAwake,
    terminalShell: Value.Check(DESKTOP_SETTING_SCHEMAS.terminalShell, terminalShell)
      ? terminalShell
      : DEFAULT_DESKTOP_SETTINGS.terminalShell,
    blockAds: Value.Check(DESKTOP_SETTING_SCHEMAS.blockAds, blockAds)
      ? blockAds
      : DEFAULT_DESKTOP_SETTINGS.blockAds,
    adblockAllowedHosts: Value.Check(
      DESKTOP_SETTING_SCHEMAS.adblockAllowedHosts,
      adblockAllowedHosts,
    )
      ? adblockAllowedHosts
      : DEFAULT_DESKTOP_SETTINGS.adblockAllowedHosts,
    upgradeToHttps: Value.Check(DESKTOP_SETTING_SCHEMAS.upgradeToHttps, upgradeToHttps)
      ? upgradeToHttps
      : DEFAULT_DESKTOP_SETTINGS.upgradeToHttps,
  };
}
