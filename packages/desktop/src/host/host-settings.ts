import { standard } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/core";
import type { HostView } from "@nyte-ai/sdk";
import { Value } from "typebox/value";
import {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_SETTING_SCHEMAS,
} from "@nyte-ai/app/contract/desktop-settings.ts";
import type { DesktopSettings } from "@nyte-ai/app/contract/desktop-settings.ts";

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
        id: "desktop.pauseOnSleep",
        label: "Pause agents while asleep",
        schema: standard(DESKTOP_SETTING_SCHEMAS.pauseOnSleep),
        default: DEFAULT_DESKTOP_SETTINGS.pauseOnSleep,
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
      {
        id: "desktop.webOrigins",
        label: "Web client origins",
        schema: standard(DESKTOP_SETTING_SCHEMAS.webOrigins),
        default: DEFAULT_DESKTOP_SETTINGS.webOrigins,
        scope: "host",
      },
      {
        id: "desktop.notifications",
        label: "Show system notifications",
        schema: standard(DESKTOP_SETTING_SCHEMAS.notifications),
        default: DEFAULT_DESKTOP_SETTINGS.notifications,
        scope: "host",
      },
      {
        id: "desktop.dockBadge",
        label: "Badge Dock icon",
        schema: standard(DESKTOP_SETTING_SCHEMAS.dockBadge),
        default: DEFAULT_DESKTOP_SETTINGS.dockBadge,
        scope: "host",
      },
      {
        id: "desktop.notificationSounds",
        label: "Play sounds",
        schema: standard(DESKTOP_SETTING_SCHEMAS.notificationSounds),
        default: DEFAULT_DESKTOP_SETTINGS.notificationSounds,
        scope: "host",
      },
      {
        id: "desktop.alertsWaiting",
        label: "Needs you",
        schema: standard(DESKTOP_SETTING_SCHEMAS.alertsWaiting),
        default: DEFAULT_DESKTOP_SETTINGS.alertsWaiting,
        scope: "host",
      },
      {
        id: "desktop.alertsFailed",
        label: "Failed",
        schema: standard(DESKTOP_SETTING_SCHEMAS.alertsFailed),
        default: DEFAULT_DESKTOP_SETTINGS.alertsFailed,
        scope: "host",
      },
      {
        id: "desktop.alertsDone",
        label: "Done",
        schema: standard(DESKTOP_SETTING_SCHEMAS.alertsDone),
        default: DEFAULT_DESKTOP_SETTINGS.alertsDone,
        scope: "host",
      },
      {
        id: "desktop.remindMinutes",
        label: "Remind every",
        schema: standard(DESKTOP_SETTING_SCHEMAS.remindMinutes),
        default: DEFAULT_DESKTOP_SETTINGS.remindMinutes,
        scope: "host",
      },
      {
        id: "desktop.notifyViewedChat",
        label: "Notify about the chat you're viewing",
        schema: standard(DESKTOP_SETTING_SCHEMAS.notifyViewedChat),
        default: DEFAULT_DESKTOP_SETTINGS.notifyViewedChat,
        scope: "host",
      },
      {
        id: "desktop.notifySubagents",
        label: "Include subagent chats",
        schema: standard(DESKTOP_SETTING_SCHEMAS.notifySubagents),
        default: DEFAULT_DESKTOP_SETTINGS.notifySubagents,
        scope: "host",
      },
      {
        id: "desktop.terminalNotifications",
        label: "Terminal notifications",
        schema: standard(DESKTOP_SETTING_SCHEMAS.terminalNotifications),
        default: DEFAULT_DESKTOP_SETTINGS.terminalNotifications,
        scope: "host",
      },
    ],
  },
} satisfies Plugin;

export function desktopSettings(view: Pick<HostView, "settings">): DesktopSettings {
  const read = <K extends keyof DesktopSettings>(key: K) => {
    const found = view.settings.find((setting) => setting.id === `desktop.${key}`)?.value;

    return Value.Check(DESKTOP_SETTING_SCHEMAS[key], found) ? found : DEFAULT_DESKTOP_SETTINGS[key];
  };

  return {
    keepAwake: read("keepAwake"),
    pauseOnSleep: read("pauseOnSleep"),
    terminalShell: read("terminalShell"),
    blockAds: read("blockAds"),
    adblockAllowedHosts: read("adblockAllowedHosts"),
    upgradeToHttps: read("upgradeToHttps"),
    webOrigins: read("webOrigins"),
    notifications: read("notifications"),
    dockBadge: read("dockBadge"),
    notificationSounds: read("notificationSounds"),
    alertsWaiting: read("alertsWaiting"),
    alertsFailed: read("alertsFailed"),
    alertsDone: read("alertsDone"),
    remindMinutes: read("remindMinutes"),
    notifyViewedChat: read("notifyViewedChat"),
    notifySubagents: read("notifySubagents"),
    terminalNotifications: read("terminalNotifications"),
  };
}
