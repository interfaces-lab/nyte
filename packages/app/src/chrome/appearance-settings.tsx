/** The route-owned desktop Settings content. */
import { Select } from "@nyte-ai/ui/select";
import * as stylex from "@stylexjs/stylex";
import { useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import {
  setStartupDestination,
  useStartupDestination,
  type StartupDestination,
} from "../startup-preference.ts";
import {
  setRunningMessagePreference,
  useRunningMessagePreference,
  type RunningMessagePreference,
} from "../conversation/running-message-preference.ts";
import {
  setLinkPreference,
  useLinkPreference,
  type LinkPreference,
} from "../conversation/link-preference.ts";
import { clientCapabilities } from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { appearanceSettingsStyles as styles } from "./appearance-settings.stylex.ts";
import { AccountsSettings } from "./accounts-settings.tsx";
import { AppearanceSettings } from "./appearance-panel.tsx";
import { ProvidersSettings } from "./models-settings.tsx";
import { UsageSettings } from "./usage-settings.tsx";
import { SettingsRow } from "./settings-controls.tsx";
import { settingsTitle, type SettingsSection } from "./settings-navigation.tsx";

function GeneralSettings(): ReactElement {
  const destination = useStartupDestination();
  const runningMessagePreference = useRunningMessagePreference();
  const linkPreference = useLinkPreference();
  const { browser } = clientCapabilities(nyte.host);

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <div {...stylex.props(settingsPatterns.sectionHeader)}>
        <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Startup</h2>
      </div>
      <div {...stylex.props(settingsPatterns.group)}>
        <SettingsRow title="Window restoration" description="Choose what opens when Nyte starts">
          <Select<StartupDestination>
            label="Window restoration"
            value={destination}
            options={[
              { value: "new-chat", label: "New chat" },
              { value: "last-session", label: "Last chat" },
            ]}
            onValueChange={setStartupDestination}
          />
        </SettingsRow>
      </div>
      <div {...stylex.props(settingsPatterns.sectionHeader)}>
        <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Chat</h2>
      </div>
      <div {...stylex.props(settingsPatterns.group)}>
        <SettingsRow
          title="Messages while running"
          description="Choose what Enter does while the agent is working"
        >
          <Select<RunningMessagePreference>
            label="Messages while running"
            value={runningMessagePreference}
            options={[
              { value: "queue", label: "Queue" },
              { value: "steer", label: "Steer" },
            ]}
            onValueChange={setRunningMessagePreference}
          />
        </SettingsRow>
      </div>
      {browser && (
        <>
          <div {...stylex.props(settingsPatterns.sectionHeader)}>
            <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Links</h2>
          </div>
          <div {...stylex.props(settingsPatterns.group)}>
            <SettingsRow title="Open links in" description="Applies to links in chat">
              <Select<LinkPreference>
                label="Open links in"
                value={linkPreference}
                options={[
                  { value: "built-in", label: "Built-in browser" },
                  { value: "external", label: "External browser" },
                ]}
                onValueChange={setLinkPreference}
              />
            </SettingsRow>
          </div>
        </>
      )}
    </section>
  );
}

function SettingsPanel({ section }: { section: SettingsSection }): ReactElement {
  switch (section) {
    case "general":
      return <GeneralSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "providers":
      return <ProvidersSettings />;
    case "usage":
      return <UsageSettings />;
    case "accounts":
      return <AccountsSettings />;
    default: {
      const _exhaustive: never = section;

      return _exhaustive;
    }
  }
}

export function SettingsSurface(): ReactElement {
  const { section } = useParams({ from: "/settings/$section" });

  return (
    <div
      data-nyte-settings-surface
      data-nyte-scrollport="balanced"
      {...stylex.props(styles.content)}
    >
      <div {...stylex.props(styles.contentInner)}>
        <div {...stylex.props(styles.panel)}>
          <div {...stylex.props(styles.titleRow)}>
            <h1 {...stylex.props(settingsPatterns.pageTitle)}>{settingsTitle(section)}</h1>
          </div>
          <SettingsPanel section={section} />
        </div>
      </div>
    </div>
  );
}
