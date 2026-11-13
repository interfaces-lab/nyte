import type { IconName } from "@nyte-ai/ui/icon";
import { available, settingsContext } from "./capability.ts";
import type { Capability } from "./capability.ts";

export interface SectionInfo {
  readonly icon: IconName;
  readonly title: string;
  readonly group: "server" | "you" | "app" | "tools" | "providers";
  readonly needs: readonly Capability[];
  readonly keywords: readonly string[];
}

/** What every settings page is called and needs, without the pages themselves, so code outside Settings can ask about a section without loading its page. */
export const SETTINGS_SECTIONS = {
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
  },
  usage: {
    icon: "trending",
    title: "Usage",
    group: "app",
    needs: ["usage"],
    keywords: ["tokens", "cost", "spend", "billing", "cache", "activity", "charts", "history"],
  },
  agent: {
    icon: "agent",
    title: "Agent",
    group: "tools",
    needs: ["providers"],
    keywords: ["model", "reasoning", "thinking", "context", "compaction", "cache"],
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
  },
  terminal: {
    icon: "console",
    title: "Terminal",
    group: "tools",
    needs: [],
    keywords: ["shell", "scrollback", "cursor", "blink"],
  },
  variables: {
    icon: "brackets",
    title: "Environment variables",
    group: "tools",
    needs: [],
    keywords: ["env", "environment", ".env", "secret", "api key", "token", "variables"],
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
  },
  browser: {
    icon: "globe",
    title: "Browser",
    group: "tools",
    needs: ["browser"],
    keywords: ["ads", "trackers", "https", "agent access", "folders"],
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
  },
  providers: {
    icon: "box-3d",
    title: "Providers",
    group: "providers",
    needs: ["providers"],
    keywords: ["api key", "sign in", "anthropic", "openai", "opencode", "fast"],
  },
} as const satisfies Record<string, SectionInfo>;

export type SettingsSection = keyof typeof SETTINGS_SECTIONS;

const ORDER = Object.keys(SETTINGS_SECTIONS).filter(namesSettingsSection);

function namesSettingsSection(value: string): value is SettingsSection {
  return Object.hasOwn(SETTINGS_SECTIONS, value);
}

export function settingsSectionGroups(
  context = settingsContext(),
): readonly (readonly SettingsSection[])[] {
  const groups: SettingsSection[][] = [];

  for (const id of ORDER) {
    const section = SETTINGS_SECTIONS[id];

    if (!available(section.needs, context)) continue;
    const last = groups.at(-1);
    const lastId = last?.at(-1);

    if (
      last !== undefined &&
      lastId !== undefined &&
      SETTINGS_SECTIONS[lastId].group === section.group
    ) {
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
  return namesSettingsSection(value) && available(SETTINGS_SECTIONS[value].needs);
}
