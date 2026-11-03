import type { HostView } from "@nyte-ai/sdk";
import { Value } from "typebox/value";
import {
  DEFAULT_DESKTOP_SETTINGS,
  DESKTOP_SETTING_SCHEMAS,
} from "@nyte-ai/app/contract/desktop-settings.ts";
import type { DesktopSettings } from "@nyte-ai/app/contract/desktop-settings.ts";

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
