import { standard } from "@nyte-ai/schema";
import { ORIGIN_PATTERN } from "@nyte-ai/schema/origin";
import { Type } from "typebox";
import type { Static } from "typebox";
import type { Plugin } from "@nyte-ai/plugin/core";

/** How a chat's state can reach you past its sidebar mark, which always shows. */
export const ALERT_CHANNELS = ["notification", "badge", "sound", "bounce", "remind"] as const;

export type AlertChannel = (typeof ALERT_CHANNELS)[number];

/** The states that alert, each with the channels it offers. Working only marks the sidebar. */
export const ALERT_OFFERS = {
  waiting: ALERT_CHANNELS,
  failed: ["notification", "badge", "sound", "bounce"],
  done: ["notification", "badge", "sound"],
} as const satisfies Readonly<Record<string, readonly AlertChannel[]>>;

export type AlertState = keyof typeof ALERT_OFFERS;

/** The desktop setting holding each state's chosen channels. */
export const ALERT_SETTING = {
  waiting: "alertsWaiting",
  failed: "alertsFailed",
  done: "alertsDone",
} as const satisfies Readonly<Record<AlertState, string>>;

/** Settings the desktop's main and host processes read; the app reads and writes them as `desktop.<key>`. */
export const DESKTOP_SETTING_SCHEMAS = {
  keepAwake: Type.Boolean(),
  pauseOnSleep: Type.Boolean(),
  terminalShell: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  blockAds: Type.Boolean(),
  adblockAllowedHosts: Type.Array(Type.String({ minLength: 1, maxLength: 253 })),
  upgradeToHttps: Type.Boolean(),
  webOrigins: Type.Array(Type.String({ pattern: ORIGIN_PATTERN })),
  notifications: Type.Boolean(),
  dockBadge: Type.Boolean(),
  notificationSounds: Type.Boolean(),
  alertsWaiting: Type.Array(Type.Enum(ALERT_OFFERS.waiting)),
  alertsFailed: Type.Array(Type.Enum(ALERT_OFFERS.failed)),
  alertsDone: Type.Array(Type.Enum(ALERT_OFFERS.done)),
  remindMinutes: Type.Union([Type.Literal(1), Type.Literal(2), Type.Literal(5), Type.Literal(15)]),
  notifyViewedChat: Type.Boolean(),
  notifySubagents: Type.Boolean(),
  terminalNotifications: Type.Boolean(),
};

export type DesktopSettings = {
  readonly [K in keyof typeof DESKTOP_SETTING_SCHEMAS]: Static<(typeof DESKTOP_SETTING_SCHEMAS)[K]>;
};

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  keepAwake: false,
  pauseOnSleep: true,
  terminalShell: null,
  blockAds: true,
  adblockAllowedHosts: [],
  upgradeToHttps: true,
  webOrigins: [],
  notifications: true,
  dockBadge: true,
  notificationSounds: true,
  alertsWaiting: ["notification", "badge", "sound", "bounce", "remind"],
  alertsFailed: ["notification", "badge", "sound"],
  alertsDone: ["notification", "badge"],
  remindMinutes: 2,
  notifyViewedChat: false,
  notifySubagents: false,
  terminalNotifications: true,
};

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
