/**
 * The Settings pages, in nav order: the one table. Navigation, route
 * validation, titles, nav groups, and which pages a host shows all derive
 * from it. Rows inside a page decide for themselves whether this host can
 * back them; a page is listed when its first row could be.
 */
import type { ComponentType } from "react";
import type { IconName } from "@nyte-ai/ui/icon";
import { clientCapabilities } from "../client-actions.ts";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import { ProvidersSettings } from "../chrome/models-settings.tsx";
import { ProfileSettingsPage } from "./profile.tsx";
import { UsageSettings } from "../chrome/usage-settings.tsx";
import { AdvancedSettings } from "./advanced.tsx";
import { AgentSettings } from "./agent.tsx";
import { AppearanceSettings } from "./appearance.tsx";
import { BrowserSettings } from "./browser.tsx";
import { EditorSettings } from "./editor.tsx";
import { GeneralSettings } from "./general.tsx";
import { TerminalSettings } from "./terminal.tsx";

/** What this host can back. A row or page shows only where everything it needs holds. */
export interface SettingsContext {
  /** ~/.nyte/settings.json is reachable: the desktop, not the web app or mobile. */
  readonly hostSettings: boolean;
  readonly mac: boolean;
  /** The built-in browser panel exists. */
  readonly browser: boolean;
  readonly terminal: boolean;
  /** Sign-ins and model defaults change here: the desktop, or a server environment not reached over the relay. */
  readonly providers: boolean;
  readonly account: boolean;
  readonly usage: boolean;
}

export type Capability = keyof SettingsContext;

/** Computed per call: the installed bridge decides, and tests install different ones. */
export function settingsContext(): SettingsContext {
  const desktop = nyte.clientSurface === "desktop";
  const ownEnvironment = desktop || (nyte.environment === true && nyte.relay !== true);
  const { browser, terminal } = clientCapabilities(nyte.host);

  return {
    hostSettings: nyte.host.settings !== undefined,
    // Tests resolve pages under node, where there is no document to ask.
    mac: typeof document !== "undefined" && macPlatform(undefined),
    browser,
    terminal,
    providers: ownEnvironment,
    account: ownEnvironment,
    usage: desktop || nyte.environment === true,
  };
}

export function available(needs: readonly Capability[], context = settingsContext()): boolean {
  return needs.every((need) => context[need]);
}

interface PageInfo {
  readonly icon: IconName;
  readonly title: string;
  /** Consecutive pages of one group sit together in the nav; space separates groups. */
  readonly group: "you" | "app" | "tools" | "providers";
  readonly needs: readonly Capability[];
  /** What the page holds beyond its title, as lowercase substrings, for the nav search. */
  readonly keywords: readonly string[];
  readonly Page: ComponentType;
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
  },
  terminal: {
    icon: "console",
    title: "Terminal",
    group: "tools",
    needs: ["terminal"],
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
  usage: {
    icon: "trending",
    title: "Usage",
    group: "providers",
    needs: ["usage"],
    keywords: ["tokens", "cost", "spend", "billing", "cache", "activity", "charts", "history"],
    Page: UsageSettings,
  },
} as const satisfies Record<string, PageInfo>;

export type SettingsSection = keyof typeof SETTINGS_PAGES;

const ORDER = Object.keys(SETTINGS_PAGES).filter(isPageId);

function isPageId(value: string): value is SettingsSection {
  return Object.hasOwn(SETTINGS_PAGES, value);
}

/** Visible pages in table order, split where the group changes. */
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

/** The route's param check: a page this host shows. */
export function isSettingsSection(value: string): value is SettingsSection {
  return isPageId(value) && available(SETTINGS_PAGES[value].needs);
}

export function settingsTitle(section: SettingsSection): string {
  return SETTINGS_PAGES[section].title;
}
