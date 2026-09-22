/**
 * Settings navigation. The rail is the settings shell: opening Settings swaps
 * this column in beside a mounted route, so a section change is a route change
 * with nothing to fade in.
 *
 * Rows reuse the rail's row geometry, so labels and icons keep their edges when
 * the column swaps. `SECTIONS` is the one table: titles, icons, and search
 * terms live together, and `SECTION_GROUPS` only orders them. Groups are
 * separated by space rather than a rule, which is why the gap between them has
 * to beat the gap between two rows.
 */
import * as stylex from "@stylexjs/stylex";
import { Link, useRouter } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { Icon, type IconName } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
import { appearanceSettingsStyles as styles } from "./appearance-settings.stylex.ts";
import { sidebarStyles as rail } from "./sidebar.stylex.ts";

interface SectionInfo {
  readonly icon: IconName;
  readonly title: string;
  /** What the section holds, beyond its title, as lowercase substrings. */
  readonly keywords: readonly string[];
}

const SECTIONS = {
  general: {
    icon: "settings",
    title: "General",
    keywords: ["startup", "window restoration", "chat", "messages", "queue", "steer"],
  },
  appearance: {
    icon: "canvas-grid",
    title: "Appearance",
    keywords: ["theme", "color", "typography", "font", "tool calls", "transparency"],
  },
  models: {
    icon: "box-3d",
    title: "Models",
    keywords: [
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
  },
  usage: {
    icon: "trending",
    title: "Usage",
    keywords: ["tokens", "cost", "spend", "billing", "cache", "activity", "charts", "history"],
  },
  accounts: { icon: "user-key", title: "Accounts", keywords: ["github", "sign out"] },
  server: {
    icon: "cloud",
    title: "Server",
    keywords: [
      "cloud",
      "remote",
      "deploy",
      "token",
      "vercel",
      "cloudflare",
      "ios",
      "iphone",
      "simulator",
      "share",
      "mobile",
    ],
  },
} as const satisfies Record<string, SectionInfo>;

export type SettingsSection = keyof typeof SECTIONS;

/** The app itself, then the agent's providers and spend, then remote hosting. */
const SECTION_GROUPS: readonly (readonly SettingsSection[])[] = [
  ["general", "appearance"],
  ["models", "usage", "accounts"],
  ["server"],
];

export function isSettingsSection(value: string): value is SettingsSection {
  return SECTION_GROUPS.some((group) => group.some((section) => section === value));
}

export function settingsTitle(section: SettingsSection): string {
  return SECTIONS[section].title;
}

export function SettingsNavigation({
  section,
}: {
  readonly section: SettingsSection;
}): ReactElement {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);

  const results = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (query === "") return undefined;
    return SECTION_GROUPS.flat().filter((id) => {
      const { title, keywords } = SECTIONS[id];
      return (
        title.toLocaleLowerCase().includes(query) ||
        keywords.some((keyword) => keyword.includes(query))
      );
    });
  }, [search]);

  // Typing can shorten the list under the cursor; the last row stays
  // highlighted rather than the highlight disappearing off the end.
  const highlighted = results === undefined ? undefined : Math.min(highlight, results.length - 1);
  // Results are one group: matches spread across the browse gaps would make the
  // arrow keys look like they skip.
  const groups = results === undefined ? SECTION_GROUPS : [results];

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearch("");
      searchRef.current?.blur();
      return;
    }
    if (results === undefined || results.length === 0 || highlighted === undefined) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setHighlight((current) => (current + delta + results.length) % results.length);
      return;
    }
    if (event.key === "Enter") {
      const target = results[highlighted];
      if (target === undefined) return;
      event.preventDefault();
      setSearch("");
      void router.navigate({
        to: "/settings/$section",
        params: { section: target },
        replace: true,
      });
    }
  };

  return (
    <div {...stylex.props(styles.navigation)}>
      <button
        type="button"
        {...stylex.props(rail.navRow, styles.back, focus.ringInset)}
        onClick={() => router.history.back()}
      >
        <span {...stylex.props(rail.navIcon)}>
          <Icon name="arrow-left" size={14} />
        </span>
        <span {...stylex.props(rail.navLabel)}>Back</span>
      </button>
      <label {...stylex.props(styles.search)}>
        <span {...stylex.props(styles.searchIcon)}>
          <Icon name="search" size={14} />
        </span>
        <input
          ref={searchRef}
          type="search"
          aria-label="Search Settings"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search Settings"
          value={search}
          {...stylex.props(styles.searchInput)}
          onChange={(event) => {
            setSearch(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={onSearchKeyDown}
        />
      </label>
      <div {...stylex.props(styles.navGroups)}>
        {groups.map((group) => (
          <div key={group[0] ?? "no-matches"} {...stylex.props(styles.navList)}>
            {group.map((id, index) => (
              <Link
                key={id}
                to="/settings/$section"
                params={{ section: id }}
                replace
                aria-current={section === id ? "page" : undefined}
                onClick={() => setSearch("")}
                {...stylex.props(
                  rail.navRow,
                  styles.navItem,
                  focus.ringInset,
                  index === highlighted && styles.navItemHighlighted,
                  section === id && rail.navRowActive,
                )}
              >
                <span {...stylex.props(rail.navIcon)}>
                  <Icon name={SECTIONS[id].icon} size={14} />
                </span>
                <span {...stylex.props(rail.navLabel)}>{SECTIONS[id].title}</span>
              </Link>
            ))}
          </div>
        ))}
        {results?.length === 0 && (
          <span {...stylex.props(styles.emptyNavigation)}>No matching settings</span>
        )}
      </div>
    </div>
  );
}
