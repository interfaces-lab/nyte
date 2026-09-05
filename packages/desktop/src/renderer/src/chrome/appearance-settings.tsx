/** The route-owned desktop Settings content. */
import * as stylex from "@stylexjs/stylex";
import { useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import {
  setStartupDestination,
  useStartupDestination,
  type StartupDestination,
} from "../startup-preference.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { appearanceSettingsStyles as styles } from "./appearance-settings.stylex.ts";
import { AccountsSettings } from "./accounts-settings.tsx";
import { AppearanceSettings } from "./appearance-panel.tsx";
import { ModelsSettings } from "./models-settings.tsx";
import { SettingsRow, SettingsSelect } from "./settings-controls.tsx";
import { settingsTitle, type SettingsSection } from "./settings-navigation.tsx";

function GeneralSettings(): ReactElement {
  const destination = useStartupDestination();

  return (
    <section {...stylex.props(settingsPatterns.section)}>
      <h2 {...stylex.props(settingsPatterns.sectionTitle)}>Startup</h2>
      <div {...stylex.props(settingsPatterns.group)}>
        <SettingsRow title="Window restoration" description="Choose what opens when Nyte starts">
          <SettingsSelect<StartupDestination>
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
    </section>
  );
}

function SettingsPanel({ section }: { section: SettingsSection }): ReactElement {
  switch (section) {
    case "general":
      return <GeneralSettings />;
    case "appearance":
      return <AppearanceSettings />;
    case "models":
      return <ModelsSettings />;
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
