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
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Row } from "@nyte-ai/ui/row";
import { appearanceSettingsStyles as styles } from "./appearance-settings.stylex.ts";
import { sidebarStyles as rail } from "./sidebar.stylex.ts";
import { nyte } from "../nyte.ts";

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
    ],
  },
  appearance: {
    icon: "canvas-grid",
    title: "Appearance",
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
  providers: {
    icon: "box-3d",
    title: "Providers",
    keywords: [
      "models",
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
} as const satisfies Record<string, SectionInfo>;

export type SettingsSection = keyof typeof SECTIONS;

/** The app itself, then the agent's providers and spend. */
const SECTION_GROUPS: readonly (readonly SettingsSection[])[] = [
  ["general", "appearance"],
  ["providers", "usage", "accounts"],
];

const WEB_SECTION_GROUPS: readonly (readonly SettingsSection[])[] = [["general", "appearance"]];

const WEB_ENVIRONMENT_SECTION_GROUPS: readonly (readonly SettingsSection[])[] = [
  ["general", "appearance"],
  ["providers", "usage", "accounts"],
];

/** What this host can show. The web app reaches Providers, Usage, and Accounts only through a server environment. */
export function settingsSectionGroups(): readonly (readonly SettingsSection[])[] {
  if (nyte.clientSurface === "desktop") return SECTION_GROUPS;

  return nyte.environment ? WEB_ENVIRONMENT_SECTION_GROUPS : WEB_SECTION_GROUPS;
}

export function isSettingsSection(value: string): value is SettingsSection {
  return settingsSectionGroups().some((group) => group.some((section) => section === value));
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
  const sectionGroups = settingsSectionGroups();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);

  const results = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();

    if (query === "") return undefined;

    return sectionGroups.flat().filter((id) => {
      const { title, keywords } = SECTIONS[id];

      return (
        title.toLocaleLowerCase().includes(query) ||
        keywords.some((keyword) => keyword.includes(query))
      );
    });
  }, [search, sectionGroups]);

  // Typing can shorten the list under the cursor; the last row stays
  // highlighted rather than the highlight disappearing off the end.
  const highlighted = results === undefined ? undefined : Math.min(highlight, results.length - 1);
  // Results are one group: matches spread across the browse gaps would make the
  // arrow keys look like they skip.
  const groups = results === undefined ? sectionGroups : [results];

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
      <Row
        variant="nav"
        data-sidebar-return
        xstyle={[rail.navRow, styles.back]}
        onClick={() => {
          if (router.history.canGoBack()) router.history.back();
          else void router.navigate({ to: "/", replace: true });
        }}
      >
        <Row.Leading>
          <Icon name="arrow-left" size={14} />
        </Row.Leading>
        <Row.Label>Back</Row.Label>
      </Row>
      <InputGroup variant="quiet" xstyle={styles.search}>
        <span {...stylex.props(styles.searchIcon)}>
          <Icon name="search" size={14} />
        </span>
        <Input
          ref={searchRef}
          type="search"
          aria-label="Search Settings"
          autoComplete="off"
          spellCheck={false}
          placeholder="Search Settings"
          value={search}
          onValueChange={(value) => {
            setSearch(value);
            setHighlight(0);
          }}
          onKeyDown={onSearchKeyDown}
        />
      </InputGroup>
      <div {...stylex.props(styles.navGroups)}>
        {groups.map((group) => (
          <div key={group[0] ?? "no-matches"} {...stylex.props(styles.navList)}>
            {group.map((id, index) => (
              <Row
                key={id}
                variant="nav"
                selected={section === id}
                render={
                  <Link to="/settings/$section" params={{ section: id }} preload="render" replace />
                }
                aria-current={section === id ? "page" : undefined}
                onClick={() => setSearch("")}
                xstyle={[
                  rail.navRow,
                  index === highlighted && section !== id && styles.navItemHighlighted,
                ]}
              >
                <Row.Leading>
                  <Icon name={SECTIONS[id].icon} size={14} />
                </Row.Leading>
                <Row.Label>{SECTIONS[id].title}</Row.Label>
              </Row>
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
