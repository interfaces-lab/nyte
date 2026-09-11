import * as stylex from "@stylexjs/stylex";
import { Link, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { Icon, type IconName } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
import { appearanceSettingsStyles as styles } from "./appearance-settings.stylex.ts";

export const SETTINGS_SECTIONS = [
  ["general", "settings"],
  ["appearance", "canvas-grid"],
  ["models", "box-3d"],
  ["usage", "trending"],
  ["accounts", "user-key"],
  ["server", "cloud"],
] as const satisfies readonly (readonly [string, IconName])[];

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number][0];

const SECTION_IDS = SETTINGS_SECTIONS.map(([id]) => id);

export function isSettingsSection(value: string): value is SettingsSection {
  return SECTION_IDS.some((id) => id === value);
}

export function settingsTitle(section: SettingsSection): string {
  switch (section) {
    case "general":
      return "General";
    case "appearance":
      return "Appearance";
    case "models":
      return "Models";
    case "usage":
      return "Usage";
    case "accounts":
      return "Accounts";
    case "server":
      return "Server";
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
}

const SECTION_ALIASES: Readonly<Record<SettingsSection, readonly string[]>> = {
  general: ["general", "startup", "window restoration"],
  appearance: ["appearance", "theme", "color", "typography", "font", "tool calls", "transparency"],
  models: [
    "models",
    "providers",
    "api key",
    "sign in",
    "anthropic",
    "openai",
    "opencode",
    "default model",
    "reasoning",
    "fast",
  ],
  usage: ["usage", "tokens", "cost", "spend", "billing", "cache", "activity", "charts", "history"],
  accounts: ["accounts", "github"],
  server: ["server", "cloud", "remote", "deploy", "token", "vercel", "cloudflare"],
};

function sectionMatches(section: SettingsSection, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized === "") return true;
  return SECTION_ALIASES[section].some((alias) => alias.includes(normalized));
}

export function SettingsNavigation({
  section,
}: {
  readonly section: SettingsSection;
}): ReactElement {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const visibleSections = useMemo(
    () => SETTINGS_SECTIONS.filter(([id]) => sectionMatches(id, query)),
    [query],
  );

  return (
    <div {...stylex.props(styles.navigation)}>
      <button
        type="button"
        {...stylex.props(styles.back, focus.ring)}
        onClick={() => router.history.back()}
      >
        <Icon name="arrow-left" size={13} />
        Back
      </button>
      <label {...stylex.props(styles.search)}>
        <span {...stylex.props(styles.searchIcon)}>
          <Icon name="search" size={13} />
        </span>
        <input
          type="search"
          aria-label="Search Settings"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search Settings"
          value={query}
          {...stylex.props(styles.searchInput)}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div {...stylex.props(styles.navList)}>
        {visibleSections.map(([id, icon]) => (
          <Link
            key={id}
            to="/settings/$section"
            params={{ section: id }}
            replace
            aria-current={section === id ? "page" : undefined}
            {...stylex.props(
              styles.navItem,
              focus.ringInset,
              section === id && styles.navItemActive,
            )}
          >
            <Icon name={icon} size={14} />
            {settingsTitle(id)}
          </Link>
        ))}
        {visibleSections.length === 0 && (
          <span {...stylex.props(styles.emptyNavigation)}>No matching settings</span>
        )}
      </div>
    </div>
  );
}
