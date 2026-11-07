import { ORIGIN_PATTERN } from "@nyte-ai/schema/origin";
import { Type } from "typebox";
import type { Static } from "typebox";

export const ALERT_CHANNELS = ["notification", "badge", "sound", "bounce", "remind"] as const;

export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_OFFERS = {
  waiting: ALERT_CHANNELS,
  failed: ["notification", "badge", "sound", "bounce"],
  done: ["notification", "badge", "sound"],
} as const satisfies Readonly<Record<string, readonly AlertChannel[]>>;

export type AlertState = keyof typeof ALERT_OFFERS;

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
