import type { ReactElement } from "react";
import { DESKTOP_SETTING_SCHEMAS } from "../contract/desktop-settings.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { SettingsSection, SwitchRow } from "../settings-rows/rows.tsx";

const blockAds = pluginSetting("desktop.blockAds", DESKTOP_SETTING_SCHEMAS.blockAds);

const upgradeToHttps = pluginSetting(
  "desktop.upgradeToHttps",
  DESKTOP_SETTING_SCHEMAS.upgradeToHttps,
);

export function BrowserSettings(): ReactElement {
  return (
    <>
      <SettingsSection title="Built-in browser">
        <SwitchRow
          setting={blockAds}
          title="Block ads and trackers"
          description="Filter requests with EasyList and EasyPrivacy"
        />
        <SwitchRow
          setting={upgradeToHttps}
          title="Upgrade to HTTPS"
          description="Try https:// first for public sites. Local addresses stay on http"
        />
      </SettingsSection>
    </>
  );
}
