import { ORIGIN_PATTERN } from "@nyte-ai/schema/origin";
import { Type } from "typebox";
import type { Static } from "typebox";

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

export type AlertSettings = Pick<
  DesktopSettings,
  "notifications" | "dockBadge" | "notificationSounds" | (typeof ALERT_SETTING)[AlertState]
>;

/** A switch that must be on before a channel can reach you: a page-wide one, or the state's notification. */
export type AlertBlocker =
  | {
      readonly kind: "master";
      readonly setting: "notifications" | "dockBadge" | "notificationSounds";
    }
  | { readonly kind: "channel"; readonly channel: "notification" };

/** The channels a state reaches you on: those chosen for it with every switch they need on. */
export function effectiveChannels(
  state: AlertState,
  settings: AlertSettings,
): readonly AlertChannel[] {
  return ALERT_OFFERS[state].filter(
    (channel) =>
      chosenChannels(state, settings).includes(channel) &&
      findAlertBlocker(channel, state, settings) === undefined,
  );
}

/**
 * What keeps a channel from reaching you, if anything. Sound and reminders repeat the
 * notification, so they need it; the Dock bounce follows the Dock badge switch.
 */
export function findAlertBlocker(
  channel: AlertChannel,
  state: AlertState,
  settings: AlertSettings,
): AlertBlocker | undefined {
  switch (channel) {
    case "notification":
      return settings.notifications ? undefined : { kind: "master", setting: "notifications" };
    case "badge":
    case "bounce":
      return settings.dockBadge ? undefined : { kind: "master", setting: "dockBadge" };
    case "remind":
    case "sound": {
      if (!settings.notifications) return { kind: "master", setting: "notifications" };

      if (!chosenChannels(state, settings).includes("notification"))
        return { kind: "channel", channel: "notification" };

      return channel === "sound" && !settings.notificationSounds
        ? { kind: "master", setting: "notificationSounds" }
        : undefined;
    }

    default: {
      const _exhaustive: never = channel;

      return _exhaustive;
    }
  }
}

/** The channels chosen for a state, whether or not they can reach you. */
export function chosenChannels(
  state: AlertState,
  settings: AlertSettings,
): readonly AlertChannel[] {
  return settings[ALERT_SETTING[state]];
}
