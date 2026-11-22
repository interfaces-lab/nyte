import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { Link, useRouter } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { Row } from "@nyte-ai/ui/row";
import { sidebarStyles as rail } from "../sidebar/sidebar.stylex.ts";
import { SETTINGS_PAGES } from "./pages.ts";
import type { PageInfo } from "./pages.ts";
import { hostWatch } from "../data/watches.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { placePluginSettings } from "./plugin-pages.ts";
import { customSection, settingsSectionGroups } from "../settings-sections/sections.ts";
import type { OpenSection, SettingsSection } from "../settings-sections/sections.ts";
import { closeSettings } from "../settings-sections/return.ts";
import { settingsStyles as styles } from "../settings-rows/settings.stylex.ts";

export function SettingsNavigation({ section }: { readonly section: OpenSection }): ReactElement {
  const router = useRouter();
  const sectionGroups = settingsSectionGroups();
  const plugins = useWatchSelect(hostWatch("host"), (state) => state.value?.plugins) ?? [];
  const settings = useWatchSelect(hostWatch("host"), (state) => state.value?.settings) ?? [];
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

  const pages = [...placePluginSettings(plugins, settings).custom.keys()].filter(
    (title) => query === "" || title.toLocaleLowerCase().includes(query),
  );

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
          <Icon name="arrow-left" size="sm" />
        </Row.Leading>
        <Row.Label>Back</Row.Label>
      </Row>
      <InputGroup variant="quiet" xstyle={styles.search}>
        <span {...props(styles.searchIcon)}>
          <Icon name="search" size="sm" />
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
                onPointerEnter={prefetchPage(id)}
                onFocus={prefetchPage(id)}
                xstyle={[
                  rail.navRow,
                  index === highlighted && section !== id && styles.navItemHighlighted,
                ]}
              >
                <Row.Leading xstyle={rail.navLeading}>
                  <Icon name={SETTINGS_PAGES[id].icon} size="sm" />
                </Row.Leading>
                <Row.Label>{SETTINGS_PAGES[id].title}</Row.Label>
              </Row>
            ))}
          </div>
        ))}
        {pages.length > 0 && (
          <div {...props(styles.navList)}>
            {pages.map((title) => (
              <Row
                key={title}
                variant="nav"
                selected={section === customSection(title)}
                render={
                  <Link
                    to="/settings/$section"
                    params={{ section: customSection(title) }}
                    preload="render"
                    replace
                  />
                }
                aria-current={section === customSection(title) ? "page" : undefined}
                onClick={() => setSearch("")}
                xstyle={rail.navRow}
              >
                <Row.Leading xstyle={rail.navLeading}>
                  <Icon name="cube" size="sm" />
                </Row.Leading>
                <Row.Label>{title}</Row.Label>
              </Row>
            ))}
          </div>
        )}
        {results?.length === 0 && pages.length === 0 && (
          <span {...props(text.sm, styles.emptyNavigation)}>No matching settings</span>
        )}
      </div>
    </div>
  );
}

function prefetchPage(id: SettingsSection): PageInfo["prefetch"] {
  const page: PageInfo = SETTINGS_PAGES[id];

  return page.prefetch;
}
