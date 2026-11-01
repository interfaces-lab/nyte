import { Button } from "@nyte-ai/ui/button";
import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import type { ReactElement } from "react";
import { modifierKeyLabel } from "../chat/composer/composer-keys.ts";
import { DESKTOP_SETTING_SCHEMAS } from "../contract/desktop-settings.ts";
import { hostSetting, preferences, useSetting } from "../preferences/index.ts";
import { pluginSetting } from "../preferences/plugin.ts";
import { SelectRow, SettingsRow, SettingsSection, SwitchRow } from "./rows.tsx";
import { settingsStyles as styles } from "./settings.stylex.ts";
import { nyte } from "../contract/nyte.ts";

const keepAwake = pluginSetting("desktop.keepAwake", DESKTOP_SETTING_SCHEMAS.keepAwake);

const pauseOnSleep = pluginSetting("desktop.pauseOnSleep", DESKTOP_SETTING_SCHEMAS.pauseOnSleep);

const STARTUP = [
  { value: "new-chat", label: "New chat" },
  { value: "last-session", label: "Last chat" },
] as const;

const RUNNING_MESSAGE = [
  { value: "steer", label: "Steer" },
  { value: "queue", label: "Queue" },
] as const;

const LINK_TARGET = [
  { value: "built-in", label: "Built-in browser" },
  { value: "external", label: "External browser" },
] as const;

const WORKSPACE_TRUST = [
  { value: "ask", label: "Ask first" },
  { value: "always", label: "Always load" },
  { value: "never", label: "Never load" },
] as const;

function TrustedSitesRow(): ReactElement {
  const hosts = useSetting(preferences.trustedLinkHosts);

  return (
    <SettingsRow
      title="Trusted sites"
      description="Sites you chose Always Open for. They skip the prompt"
    >
      <span {...props(text.base, styles.rowValue)}>
        {hosts.length === 1 ? "1 site" : `${String(hosts.length)} sites`}
      </span>
      <Button
        variant="outline"
        disabled={hosts.length === 0}
        onClick={() => preferences.trustedLinkHosts.set([])}
      >
        Clear
      </Button>
    </SettingsRow>
  );
}

export function GeneralSettings(): ReactElement {
  const modifier = modifierKeyLabel(nyte.platform === "darwin");

  return (
    <>
      <SettingsSection title="Startup">
        <SelectRow
          setting={preferences.startupDestination}
          title="Window restoration"
          description="Open a new chat, or return to the chat you had open"
          options={STARTUP}
        />
      </SettingsSection>
      <SettingsSection title="Chat">
        <SelectRow
          setting={preferences.runningMessage}
          title="Messages while running"
          description={`What Enter does while the agent works. ${modifier}Enter does the other`}
          options={RUNNING_MESSAGE}
        />
      </SettingsSection>
      <SettingsSection title="Links">
        <SelectRow
          setting={preferences.linkTarget}
          title="Open links in"
          description="Built-in opens the page in a tab beside the chat"
          options={LINK_TARGET}
          needs={["browser"]}
        />
        <SwitchRow
          setting={preferences.confirmExternalLinks}
          title="Ask before opening links"
          description="Confirm before a chat link opens in your default browser"
        />
        <TrustedSitesRow />
      </SettingsSection>
      <SettingsSection title="Folders">
        <SelectRow
          setting={hostSetting("workspaceTrust")}
          title="A folder's own plugins and skills"
          description="Found under .nyte, .agents, or .claude. Loading them runs their code. Never load still lets Nyte work in the folder"
          options={WORKSPACE_TRUST}
        />
      </SettingsSection>
      <SettingsSection title="System">
        <SwitchRow
          setting={keepAwake}
          title="Keep awake while working"
          description="Stop the computer from sleeping while a chat is working. The display can still turn off"
          needs={["desktop"]}
        />
        <SwitchRow
          setting={pauseOnSleep}
          title="Pause agents while asleep"
          description="Stop model requests while the computer sleeps. Chats continue when it wakes"
          needs={["desktop"]}
        />
      </SettingsSection>
    </>
  );
}
