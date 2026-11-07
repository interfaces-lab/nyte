import { ALERT_OFFERS, ALERT_SETTING } from "@nyte-ai/plugin/desktop-settings/schema";
import type {
  AlertChannel,
  AlertState,
  DesktopSettings,
} from "@nyte-ai/plugin/desktop-settings/schema";

export {
  ALERT_CHANNELS,
  ALERT_OFFERS,
  ALERT_SETTING,
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_SETTING_SCHEMAS,
} from "@nyte-ai/plugin/desktop-settings/schema";

export type {
  AlertChannel,
  AlertState,
  DesktopSettings,
} from "@nyte-ai/plugin/desktop-settings/schema";

export type AlertSettings = Pick<
  DesktopSettings,
  "notifications" | "dockBadge" | "notificationSounds" | (typeof ALERT_SETTING)[AlertState]
>;

export type AlertBlocker =
  | {
      readonly kind: "master";
      readonly setting: "notifications" | "dockBadge" | "notificationSounds";
    }
  | { readonly kind: "channel"; readonly channel: "notification" };

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

export function chosenChannels(
  state: AlertState,
  settings: AlertSettings,
): readonly AlertChannel[] {
  return settings[ALERT_SETTING[state]];
}
