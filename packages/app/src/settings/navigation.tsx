import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Link, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Row } from "@nyte-ai/ui/row";
import { sidebarStyles as rail } from "../chrome/sidebar.stylex.ts";
import { SETTINGS_PAGES, settingsSectionGroups, type SettingsSection } from "./pages.ts";
import { closeSettings } from "./return.ts";
import { settingsStyles as styles } from "./settings.stylex.ts";

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

  const query = search.trim().toLocaleLowerCase();

  const results =
    query === ""
      ? undefined
      : sectionGroups.flat().filter((id) => {
          const { title, keywords } = SETTINGS_PAGES[id];

          return (
            title.toLocaleLowerCase().includes(query) ||
            keywords.some((keyword) => keyword.includes(query))
          );
        });

  const highlighted = results === undefined ? undefined : Math.min(highlight, results.length - 1);
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
    <div {...props(styles.navigation)}>
      <Row
        variant="nav"
        data-sidebar-return
        xstyle={[rail.navRow, styles.back]}
        onClick={() => closeSettings(router)}
      >
        <Row.Leading xstyle={rail.navLeading}>
          <Icon name="arrow-left" size={14} />
        </Row.Leading>
        <Row.Label>Back</Row.Label>
      </Row>
      <InputGroup variant="quiet" xstyle={styles.search}>
        <span {...props(styles.searchIcon)}>
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
      <div {...props(styles.navGroups)}>
        {groups.map((group) => (
          <div key={group[0] ?? "no-matches"} {...props(styles.navList)}>
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
                <Row.Leading xstyle={rail.navLeading}>
                  <Icon name={SETTINGS_PAGES[id].icon} size={14} />
                </Row.Leading>
                <Row.Label>{SETTINGS_PAGES[id].title}</Row.Label>
              </Row>
            ))}
          </div>
        ))}
        {results?.length === 0 && (
          <span {...props(text.sm, styles.emptyNavigation)}>No matching settings</span>
        )}
      </div>
    </div>
  );
}
