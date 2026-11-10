import type { ComponentType } from "react";
import type { IconName } from "@nyte-ai/ui/icon";
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
import { available, settingsContext } from "./capability.ts";
import type { Capability } from "./capability.ts";

export interface PageInfo {
  readonly icon: IconName;
  readonly title: string;
  readonly group: "server" | "you" | "app" | "tools" | "providers";
  readonly needs: readonly Capability[];
  readonly keywords: readonly string[];
  readonly Page: ComponentType;
  readonly Actions?: ComponentType;
  readonly prefetch?: () => void;
}

function prefetchPreviews(): void {
  void loadDeferred("previews").catch(() => {});
}

export const SETTINGS_PAGES = {
  server: {
    icon: "server",
    title: "Server",
    group: "server",
    needs: ["desktop"],
    keywords: [
      "remote access",
      "tailscale",
      "pair",
      "qr code",
      "iphone",
      "address",
      "token",
      "cloudflare",
      "tunnel",
      "remote host",
      "connect",
      "share",
    ],
    Page: ServerSettings,
  },
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
  notifications: {
    icon: "bell",
    title: "Notifications",
    group: "app",
    needs: ["desktop"],
    keywords: [
      "alerts",
      "needs you",
      "question",
      "done",
      "failed",
      "dock",
      "badge",
      "bounce",
      "sound",
      "remind",
      "toast",
      "terminal",
      "osc",
    ],
    Page: NotificationsSettings,
    prefetch: prefetchPreviews,
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
    prefetch: prefetchPreviews,
  },
  themes: {
    icon: "circles",
    title: "Themes",
    group: "app",
    needs: [],
    keywords: [
      "theme",
      "color",
      "vs code",
      "vscode",
      "import",
      "light mode",
      "dark mode",
      "github",
      "dracula",
      "catppuccin",
      "solarized",
      "nord",
      "tokyo night",
      "pierre",
    ],
    Page: ThemesSettings,
  },
  usage: {
    icon: "trending",
    title: "Usage",
    group: "app",
    needs: ["usage"],
    keywords: ["tokens", "cost", "spend", "billing", "cache", "activity", "charts", "history"],
    Page: UsageSettings,
    Actions: UsageRangePicker,
    prefetch: prefetchUsage,
  },
  agent: {
    icon: "agent",
    title: "Agent",
    group: "tools",
    needs: ["providers"],
    keywords: ["model", "reasoning", "thinking", "context", "compaction", "cache"],
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
    prefetch: prefetchPreviews,
  },
  terminal: {
    icon: "console",
    title: "Terminal",
    group: "tools",
    needs: [],
    keywords: ["shell", "scrollback", "cursor", "blink"],
    Page: TerminalSettings,
    prefetch: prefetchPreviews,
  },
  variables: {
    icon: "brackets",
    title: "Environment variables",
    group: "tools",
    needs: [],
    keywords: ["env", "environment", ".env", "secret", "api key", "token", "variables"],
    Page: VariablesSettings,
  },
  "source-control": {
    icon: "git-branch",
    title: "Source control",
    group: "tools",
    needs: [],
    keywords: [
      "git",
      "branch",
      "prefix",
      "worktree",
      "cleanup",
      "disk",
      "storage",
      "node_modules",
      "dependencies",
    ],
    Page: SourceControlSettings,
  },
  browser: {
    icon: "globe",
    title: "Browser",
    group: "tools",
    needs: ["browser"],
    keywords: ["ads", "trackers", "https", "agent access", "folders"],
    Page: BrowserSettings,
  },
  developer: {
    icon: "code-brackets",
    title: "Developer",
    group: "tools",
    needs: [],
    keywords: [
      "developer mode",
      "debug",
      "updates",
      "update channel",
      "stable",
      "nightly",
      "trace",
      "telemetry",
      "opentelemetry",
      "cli",
      "origins",
      "web client",
    ],
    Page: DeveloperSettings,
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

/** Where Settings opens: the first page its sidebar lists for this client. */
export function firstSettingsSection(): SettingsSection {
  return settingsSectionGroups().flat()[0] ?? "general";
}

export function showsSettingsSection(value: string): value is SettingsSection {
  return namesSettingsPage(value) && available(SETTINGS_PAGES[value].needs);
}
