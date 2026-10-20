import type { ComponentType } from "react";
import type { IconName } from "@nyte-ai/ui/icon";
import { ProvidersSettings } from "../chrome/models-settings.tsx";
import { ProfileSettingsPage } from "./profile.tsx";
import { UsageRangePicker, UsageSettings } from "../chrome/usage-settings.tsx";
import { AdvancedSettings } from "./advanced.tsx";
import { AgentSettings } from "./agent.tsx";
import { AppearanceSettings } from "./appearance.tsx";
import { BrowserSettings } from "./browser.tsx";
import { EditorSettings } from "./editor.tsx";
import { GeneralSettings } from "./general.tsx";
import { TerminalSettings } from "./terminal.tsx";
import { available, settingsContext } from "./capability.ts";
import type { Capability } from "./capability.ts";

export interface PageInfo {
  readonly icon: IconName;
  readonly title: string;
  readonly group: "you" | "app" | "tools" | "providers";
  readonly needs: readonly Capability[];
  readonly keywords: readonly string[];
  readonly Page: ComponentType;
  readonly Actions?: ComponentType;
}

export const SETTINGS_PAGES = {
  profile: {
    icon: "user",
    title: "Profile",
    group: "you",
    needs: ["account"],
    keywords: [
      "account",
      "nyte",
      "email",
      "sign in",
      "sign out",
      "github",
      "repository",
      "pull request",
      "iphone",
      "remote access",
    ],
    Page: ProfileSettingsPage,
  },
  general: {
    icon: "settings",
    title: "General",
    group: "app",
    needs: [],
    keywords: [
      "startup",
      "window restoration",
      "chat",
      "messages",
      "queue",
      "steer",
      "links",
      "browser",
      "external",
      "trusted sites",
      "folders",
      "trust",
      "workspace",
      "sleep",
      "awake",
    ],
    Page: GeneralSettings,
  },
  appearance: {
    icon: "canvas-grid",
    title: "Appearance",
    group: "app",
    needs: [],
    keywords: [
      "theme",
      "color",
      "typography",
      "font",
      "tool calls",
      "transparency",
      "cursor",
      "pointer",
    ],
    Page: AppearanceSettings,
  },
  usage: {
    icon: "trending",
    title: "Usage",
    group: "app",
    needs: ["usage"],
    keywords: ["tokens", "cost", "spend", "billing", "cache", "activity", "charts", "history"],
    Page: UsageSettings,
    Actions: UsageRangePicker,
  },
  agent: {
    icon: "agent",
    title: "Agent",
    group: "tools",
    needs: ["providers"],
    keywords: [
      "model",
      "reasoning",
      "thinking",
      "context",
      "compaction",
      "cache",
      "permissions",
      "approvals",
    ],
    Page: AgentSettings,
  },
  editor: {
    icon: "file-text",
    title: "Editor",
    group: "tools",
    needs: [],
    keywords: [
      "files",
      "line numbers",
      "word wrap",
      "git blame",
      "auto save",
      "format on save",
      "changes",
      "diff",
      "split",
      "unified",
      "whitespace",
    ],
    Page: EditorSettings,
  },
  terminal: {
    icon: "console",
    title: "Terminal",
    group: "tools",
    needs: [],
    keywords: ["shell", "scrollback", "cursor", "blink"],
    Page: TerminalSettings,
  },
  browser: {
    icon: "globe",
    title: "Browser",
    group: "tools",
    needs: ["hostSettings", "browser"],
    keywords: ["ads", "trackers", "https", "agent access", "folders"],
    Page: BrowserSettings,
  },
  advanced: {
    icon: "code-brackets",
    title: "Advanced",
    group: "tools",
    needs: ["hostSettings"],
    keywords: ["trace", "telemetry", "diagnostics", "opentelemetry"],
    Page: AdvancedSettings,
  },
  providers: {
    icon: "box-3d",
    title: "Providers",
    group: "providers",
    needs: ["providers"],
    keywords: ["api key", "sign in", "anthropic", "openai", "opencode", "fast"],
    Page: ProvidersSettings,
  },
} as const satisfies Record<string, PageInfo>;

export type SettingsSection = keyof typeof SETTINGS_PAGES;

const ORDER = Object.keys(SETTINGS_PAGES).filter(namesSettingsPage);

function namesSettingsPage(value: string): value is SettingsSection {
  return Object.hasOwn(SETTINGS_PAGES, value);
}

export function settingsSectionGroups(
  context = settingsContext(),
): readonly (readonly SettingsSection[])[] {
  const groups: SettingsSection[][] = [];

  for (const id of ORDER) {
    const page = SETTINGS_PAGES[id];

    if (!available(page.needs, context)) continue;
    const last = groups.at(-1);
    const lastId = last?.at(-1);

    if (last !== undefined && lastId !== undefined && SETTINGS_PAGES[lastId].group === page.group) {
      last.push(id);
    } else {
      groups.push([id]);
    }
  }

  return groups;
}

export function showsSettingsSection(value: string): value is SettingsSection {
  return namesSettingsPage(value) && available(SETTINGS_PAGES[value].needs);
}
