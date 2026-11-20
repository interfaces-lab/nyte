import { standard } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/core";
import { DESKTOP_SETTING_SCHEMAS, DEFAULT_DESKTOP_SETTINGS } from "./schema.ts";

export const desktopSettingsPlugin = {
  id: "desktop",
  contribute: {
    settings: [
      {
        id: "desktop.keepAwake",
        title: "Keep awake while working",
        schema: standard(DESKTOP_SETTING_SCHEMAS.keepAwake),
        default: DEFAULT_DESKTOP_SETTINGS.keepAwake,
      },
      {
        id: "desktop.pauseOnSleep",
        title: "Pause agents while asleep",
        schema: standard(DESKTOP_SETTING_SCHEMAS.pauseOnSleep),
        default: DEFAULT_DESKTOP_SETTINGS.pauseOnSleep,
      },
      {
        id: "desktop.terminalShell",
        title: "Terminal shell",
        schema: standard(DESKTOP_SETTING_SCHEMAS.terminalShell),
        default: DEFAULT_DESKTOP_SETTINGS.terminalShell,
      },
      {
        id: "desktop.blockAds",
        title: "Block ads",
        schema: standard(DESKTOP_SETTING_SCHEMAS.blockAds),
        default: DEFAULT_DESKTOP_SETTINGS.blockAds,
      },
      {
        id: "desktop.adblockAllowedHosts",
        title: "Shield paused on",
        schema: standard(DESKTOP_SETTING_SCHEMAS.adblockAllowedHosts),
        default: [],
      },
      {
        id: "desktop.upgradeToHttps",
        title: "Upgrade to HTTPS",
        schema: standard(DESKTOP_SETTING_SCHEMAS.upgradeToHttps),
        default: DEFAULT_DESKTOP_SETTINGS.upgradeToHttps,
      },
      {
        id: "desktop.webOrigins",
        title: "Web client origins",
        schema: standard(DESKTOP_SETTING_SCHEMAS.webOrigins),
        default: DEFAULT_DESKTOP_SETTINGS.webOrigins,
      },
      {
        id: "desktop.notifications",
        title: "Show system notifications",
        schema: standard(DESKTOP_SETTING_SCHEMAS.notifications),
        default: DEFAULT_DESKTOP_SETTINGS.notifications,
      },
      {
        id: "desktop.dockBadge",
        title: "Badge Dock icon",
        schema: standard(DESKTOP_SETTING_SCHEMAS.dockBadge),
        default: DEFAULT_DESKTOP_SETTINGS.dockBadge,
      },
      {
        id: "desktop.notificationSounds",
        title: "Play sounds",
        schema: standard(DESKTOP_SETTING_SCHEMAS.notificationSounds),
        default: DEFAULT_DESKTOP_SETTINGS.notificationSounds,
      },
      {
        id: "desktop.alertsWaiting",
        title: "Needs you",
        schema: standard(DESKTOP_SETTING_SCHEMAS.alertsWaiting),
        default: DEFAULT_DESKTOP_SETTINGS.alertsWaiting,
      },
      {
        id: "desktop.alertsFailed",
        title: "Failed",
        schema: standard(DESKTOP_SETTING_SCHEMAS.alertsFailed),
        default: DEFAULT_DESKTOP_SETTINGS.alertsFailed,
      },
      {
        id: "desktop.alertsDone",
        title: "Done",
        schema: standard(DESKTOP_SETTING_SCHEMAS.alertsDone),
        default: DEFAULT_DESKTOP_SETTINGS.alertsDone,
      },
      {
        id: "desktop.remindMinutes",
        title: "Remind every",
        schema: standard(DESKTOP_SETTING_SCHEMAS.remindMinutes),
        default: DEFAULT_DESKTOP_SETTINGS.remindMinutes,
      },
      {
        id: "desktop.notifySubagents",
        title: "Include subagent chats",
        schema: standard(DESKTOP_SETTING_SCHEMAS.notifySubagents),
        default: DEFAULT_DESKTOP_SETTINGS.notifySubagents,
      },
      {
        id: "desktop.terminalNotifications",
        title: "Terminal notifications",
        schema: standard(DESKTOP_SETTING_SCHEMAS.terminalNotifications),
        default: DEFAULT_DESKTOP_SETTINGS.terminalNotifications,
      },
    ],
  },
} satisfies Plugin;
