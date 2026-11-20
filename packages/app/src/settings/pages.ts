import type { ComponentType } from "react";
import { ProvidersSettings } from "./models-settings.tsx";
import { ProfileSettingsPage } from "./profile.tsx";
import { prefetchUsage, UsageRangePicker, UsageSettings } from "./usage-settings.tsx";
import { AgentSettings } from "./agent.tsx";
import { DeveloperSettings } from "./developer.tsx";
import { NotificationsSettings } from "./notifications.tsx";
import { ServerSettings } from "./server.tsx";
import { AppearanceSettings } from "./appearance.tsx";
import { BrowserSettings } from "./browser.tsx";
import { EditorSettings } from "./editor.tsx";
import { GeneralSettings } from "./general.tsx";
import { TerminalSettings } from "./terminal.tsx";
import { ThemesSettings } from "./themes.tsx";
import { VariablesSettings } from "./variables.tsx";
import { SourceControlSettings } from "./source-control.tsx";
import { loadDeferred } from "../lib/deferred.tsx";
import { SETTINGS_SECTIONS } from "./sections.ts";
import type { SectionInfo, SettingsSection } from "./sections.ts";

export interface PageInfo extends SectionInfo {
  readonly Page: ComponentType;
  readonly Actions?: ComponentType;
  readonly prefetch?: () => void;
}

function prefetchPreviews(): void {
  void loadDeferred("previews").catch(() => {});
}

export const SETTINGS_PAGES = {
  server: { ...SETTINGS_SECTIONS.server, Page: ServerSettings },
  profile: { ...SETTINGS_SECTIONS.profile, Page: ProfileSettingsPage },
  general: { ...SETTINGS_SECTIONS.general, Page: GeneralSettings },
  notifications: {
    ...SETTINGS_SECTIONS.notifications,
    Page: NotificationsSettings,
    prefetch: prefetchPreviews,
  },
  appearance: {
    ...SETTINGS_SECTIONS.appearance,
    Page: AppearanceSettings,
    prefetch: prefetchPreviews,
  },
  themes: { ...SETTINGS_SECTIONS.themes, Page: ThemesSettings },
  usage: {
    ...SETTINGS_SECTIONS.usage,
    Page: UsageSettings,
    Actions: UsageRangePicker,
    prefetch: prefetchUsage,
  },
  agent: { ...SETTINGS_SECTIONS.agent, Page: AgentSettings },
  editor: { ...SETTINGS_SECTIONS.editor, Page: EditorSettings, prefetch: prefetchPreviews },
  terminal: { ...SETTINGS_SECTIONS.terminal, Page: TerminalSettings, prefetch: prefetchPreviews },
  variables: { ...SETTINGS_SECTIONS.variables, Page: VariablesSettings },
  "source-control": { ...SETTINGS_SECTIONS["source-control"], Page: SourceControlSettings },
  browser: { ...SETTINGS_SECTIONS.browser, Page: BrowserSettings },
  developer: { ...SETTINGS_SECTIONS.developer, Page: DeveloperSettings },
  providers: { ...SETTINGS_SECTIONS.providers, Page: ProvidersSettings },
} as const satisfies Record<SettingsSection, PageInfo>;
