import { standard } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/core";
import type { HostView } from "@nyte-ai/sdk";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const schemas = {
  keepAwake: Type.Boolean(),
  terminalShell: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  blockAds: Type.Boolean(),
  adblockAllowedHosts: Type.Array(Type.String({ minLength: 1, maxLength: 253 })),
  upgradeToHttps: Type.Boolean(),
};

/** The desktop's own host settings as main reads them from `HostView.settings`. */
export type DesktopSettings = { readonly [K in keyof typeof schemas]: Static<(typeof schemas)[K]> };

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  keepAwake: false,
  terminalShell: null,
  blockAds: true,
  adblockAllowedHosts: [],
  upgradeToHttps: true,
};

/**
 * Contributes the desktop's host-scope settings, `desktop.<key>`: keep
 * awake, the terminal shell and the browser shield. The renderer writes them
 * with `connection.settings.apply`; main reads them back from `host.watch()`.
 */
export const desktopSettingsPlugin = {
  id: "desktop",
  contribute: {
    settings: [
      {
        id: "desktop.keepAwake",
        label: "Keep awake while working",
        schema: standard(schemas.keepAwake),
        default: DEFAULT_DESKTOP_SETTINGS.keepAwake,
        scope: "host",
      },
      {
        id: "desktop.terminalShell",
        label: "Terminal shell",
        schema: standard(schemas.terminalShell),
        default: DEFAULT_DESKTOP_SETTINGS.terminalShell,
        scope: "host",
      },
      {
        id: "desktop.blockAds",
        label: "Block ads",
        schema: standard(schemas.blockAds),
        default: DEFAULT_DESKTOP_SETTINGS.blockAds,
        scope: "host",
      },
      {
        id: "desktop.adblockAllowedHosts",
        label: "Shield paused on",
        schema: standard(schemas.adblockAllowedHosts),
        default: [],
        scope: "host",
      },
      {
        id: "desktop.upgradeToHttps",
        label: "Upgrade to HTTPS",
        schema: standard(schemas.upgradeToHttps),
        default: DEFAULT_DESKTOP_SETTINGS.upgradeToHttps,
        scope: "host",
      },
    ],
  },
} satisfies Plugin;

/** Returns the desktop settings a host view carries, each falling back to its default when absent or malformed. */
export function desktopSettings(view: Pick<HostView, "settings">): DesktopSettings {
  const value = (key: keyof DesktopSettings) =>
    view.settings.find((setting) => setting.id === `desktop.${key}`)?.value;

  const keepAwake = value("keepAwake");
  const terminalShell = value("terminalShell");
  const blockAds = value("blockAds");
  const adblockAllowedHosts = value("adblockAllowedHosts");
  const upgradeToHttps = value("upgradeToHttps");

  return {
    keepAwake: Value.Check(schemas.keepAwake, keepAwake)
      ? keepAwake
      : DEFAULT_DESKTOP_SETTINGS.keepAwake,
    terminalShell: Value.Check(schemas.terminalShell, terminalShell)
      ? terminalShell
      : DEFAULT_DESKTOP_SETTINGS.terminalShell,
    blockAds: Value.Check(schemas.blockAds, blockAds)
      ? blockAds
      : DEFAULT_DESKTOP_SETTINGS.blockAds,
    adblockAllowedHosts: Value.Check(schemas.adblockAllowedHosts, adblockAllowedHosts)
      ? adblockAllowedHosts
      : DEFAULT_DESKTOP_SETTINGS.adblockAllowedHosts,
    upgradeToHttps: Value.Check(schemas.upgradeToHttps, upgradeToHttps)
      ? upgradeToHttps
      : DEFAULT_DESKTOP_SETTINGS.upgradeToHttps,
  };
}
