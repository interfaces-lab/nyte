/** The route-owned desktop Settings content. */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@nyte-ai/ui/select";
import { props } from "@stylexjs/stylex";
import { useParams, useRouter } from "@tanstack/react-router";
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
import { AppearanceSettings } from "./appearance-panel.tsx";
import { ProvidersSettings } from "./models-settings.tsx";
import { ProfileSettings } from "./profile-settings.tsx";
import { UsageSettings } from "./usage-settings.tsx";
import { SettingsRow } from "./settings-controls.tsx";
import { settingsTitle, type SettingsSection } from "./settings-navigation.tsx";
import { openEnvironmentsFromSettings } from "./settings-return.ts";

const STARTUP_OPTIONS = [
  { value: "new-chat", label: "New chat" },
  { value: "last-session", label: "Last chat" },
] as const satisfies readonly { readonly value: StartupDestination; readonly label: string }[];

const RUNNING_MESSAGE_OPTIONS = [
  { value: "steer", label: "Steer" },
  { value: "queue", label: "Queue" },
] as const satisfies readonly {
  readonly value: RunningMessagePreference;
  readonly label: string;
}[];

const LINK_OPTIONS = [
  { value: "built-in", label: "Built-in browser" },
  { value: "external", label: "External browser" },
] as const satisfies readonly { readonly value: LinkPreference; readonly label: string }[];

function GeneralSettings(): ReactElement {
  const destination = useStartupDestination();
  const runningMessagePreference = useRunningMessagePreference();
  const linkPreference = useLinkPreference();
  const { browser } = clientCapabilities(nyte.host);

  return (
    <section {...props(settingsPatterns.section)}>
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>Startup</h2>
      </div>
      <div {...props(settingsPatterns.group)}>
        <SettingsRow title="Window restoration" description="Choose what opens when Nyte starts">
          <Select
            items={STARTUP_OPTIONS}
            value={destination}
            onValueChange={(next) => {
              if (next !== null) setStartupDestination(next);
            }}
          >
            <SelectTrigger aria-label="Window restoration">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STARTUP_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </div>
      <div {...props(settingsPatterns.sectionHeader)}>
        <h2 {...props(settingsPatterns.sectionTitle)}>Chat</h2>
      </div>
      <div {...props(settingsPatterns.group)}>
        <SettingsRow
          title="Messages while running"
          description="Choose what Enter does while the agent is working"
        >
          <Select
            items={RUNNING_MESSAGE_OPTIONS}
            value={runningMessagePreference}
            onValueChange={(next) => {
              if (next !== null) setRunningMessagePreference(next);
            }}
          >
            <SelectTrigger aria-label="Messages while running">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RUNNING_MESSAGE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value} label={option.label}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
      </div>
      {browser && (
        <>
          <div {...props(settingsPatterns.sectionHeader)}>
            <h2 {...props(settingsPatterns.sectionTitle)}>Links</h2>
          </div>
          <div {...props(settingsPatterns.group)}>
            <SettingsRow title="Open links in" description="Applies to links in chat">
              <Select
                items={LINK_OPTIONS}
                value={linkPreference}
                onValueChange={(next) => {
                  if (next !== null) setLinkPreference(next);
                }}
              >
                <SelectTrigger aria-label="Open links in">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LINK_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value} label={option.label}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>
          </div>
        </>
      )}
    </section>
  );
}

function SettingsPanel({ section }: { section: SettingsSection }): ReactElement {
  const router = useRouter();

  switch (section) {
    case "general":
      return <GeneralSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "providers":
      return <ProvidersSettings />;
    case "usage":
      return <UsageSettings />;
    case "profile":
      return <ProfileSettings onOpenEnvironments={() => openEnvironmentsFromSettings(router)} />;
    default: {
      const _exhaustive: never = section;

      return _exhaustive;
    }
  }
}

export function SettingsSurface(): ReactElement {
  const { section } = useParams({ from: "/settings/$section" });

  return (
    <div data-nyte-settings-surface data-nyte-scrollport="balanced" {...props(styles.content)}>
      <div {...props(styles.contentInner)}>
        <div {...props(styles.panel)}>
          <div {...props(styles.titleRow)}>
            <h1 {...props(settingsPatterns.pageTitle)}>{settingsTitle(section)}</h1>
          </div>
          <SettingsPanel section={section} />
        </div>
      </div>
    </div>
  );
}
