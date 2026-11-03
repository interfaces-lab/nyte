import { standard } from "@nyte-ai/schema";
import type { Plugin } from "@nyte-ai/plugin/core";
import { DESKTOP_SETTING_SCHEMAS, DEFAULT_DESKTOP_SETTINGS } from "./schema.ts";

/** Declares the desktop app's host-scoped settings, so a host the app connects to reads and writes them as `desktop.<key>`. */
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
