import { props } from "@stylexjs/stylex";
import { useParams } from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { hostWatch } from "../data/watches.ts";
import { useWatchSelect } from "../data/watch-store.ts";
import { settingsPatterns } from "../theme/settings-patterns.stylex.ts";
import { SETTINGS_PAGES } from "./pages.ts";
import type { PageInfo } from "./pages.ts";
import { placePluginSettings } from "./plugin-pages.ts";
import { PluginGroups } from "./plugin-settings.tsx";
import { namesCustomSection, readCustomSection } from "./sections.ts";
import type { OpenSection } from "./sections.ts";
import { settingsStyles as styles } from "./settings.stylex.ts";

export function SettingsSurface(): ReactElement {
  const section: OpenSection = useParams({ from: "/settings/$section" }).section;
  const plugins = useWatchSelect(hostWatch("host"), (state) => state.value?.plugins) ?? [];
  const settings = useWatchSelect(hostWatch("host"), (state) => state.value?.settings) ?? [];
  const placed = placePluginSettings(plugins, settings);

  if (namesCustomSection(section)) {
    const title = readCustomSection(section);

    return (
      <Surface title={title}>
        <PluginGroups groups={placed.custom.get(title) ?? []} />
      </Surface>
    );
  }

  const page: PageInfo = SETTINGS_PAGES[section];
  const Page = page.Page;
  const Actions = page.Actions;

  return (
    <Surface title={page.title} actions={Actions === undefined ? undefined : <Actions />}>
      <Page />
      <PluginGroups groups={placed.preset.get(section) ?? []} />
    </Surface>
  );
}

function Surface({
  title,
  actions,
  children,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <div data-nyte-settings-surface data-nyte-scrollport="balanced" {...props(styles.content)}>
      <div {...props(styles.contentInner)}>
        <div {...props(styles.panel)}>
          <div {...props(styles.titleRow)}>
            <h1 {...props(settingsPatterns.pageTitle)}>{title}</h1>
            {actions}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
