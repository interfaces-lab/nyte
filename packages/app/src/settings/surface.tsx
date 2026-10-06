/** The route-owned Settings content: one h1, then the page's sections. */
import { props } from "@stylexjs/stylex";
import { useParams } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { SETTINGS_PAGES } from "./pages.ts";
import { settingsStyles as styles } from "./settings.stylex.ts";

export function SettingsSurface(): ReactElement {
  const { section } = useParams({ from: "/settings/$section" });
  const { title, Page } = SETTINGS_PAGES[section];

  return (
    <div data-nyte-settings-surface data-nyte-scrollport="balanced" {...props(styles.content)}>
      <div {...props(styles.contentInner)}>
        <div {...props(styles.panel)}>
          <div {...props(styles.titleRow)}>
            <h1 {...props(settingsPatterns.pageTitle)}>{title}</h1>
          </div>
          <Page />
        </div>
      </div>
    </div>
  );
}
