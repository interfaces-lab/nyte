import type { ReactElement } from "react";
import { DESKTOP_SETTING_SCHEMAS } from "../contract/desktop-settings.ts";
import { hostSetting } from "../preferences/index.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { SelectRow, SettingsSection, SwitchRow } from "./rows.tsx";

const blockAds = pluginSetting("desktop.blockAds", DESKTOP_SETTING_SCHEMAS.blockAds);

const upgradeToHttps = pluginSetting(
  "desktop.upgradeToHttps",
  DESKTOP_SETTING_SCHEMAS.upgradeToHttps,
);

const ACCESS = [
  { value: "ask", label: "Ask" },
  { value: "full", label: "Full access" },
  { value: "read", label: "Read only" },
  { value: "off", label: "Off" },
] as const;

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
      <SettingsSection title="Agent access">
        <SelectRow
          setting={hostSetting("browserAccess")}
          title="New folders"
          description="The browser is signed in as you. Read only can open and read pages, but not click or type"
          options={ACCESS}
        />
      </SettingsSection>
    </>
  );
}
