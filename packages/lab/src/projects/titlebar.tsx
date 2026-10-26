import { props } from "@stylexjs/stylex";
import type { ReactElement } from "react";
import { titlebarStyles } from "@nyte-ai/app/chrome/titlebar.stylex.ts";
import { WindowTabStrip } from "@nyte-ai/app/tabs/window-tab-strip.tsx";
import type { WindowTabItem } from "@nyte-ai/app/tabs/window-tab-strip.tsx";
import { PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Toggle } from "@nyte-ai/ui/toggle";
import { styles } from "./page.stylex";

export function Titlebar({
  tabs,
  active,
  sidebar,
  onSidebar,
  onActivate,
  onClose,
  onReorder,
  onNewTab,
}: {
  readonly tabs: readonly WindowTabItem[];
  readonly active: string;
  readonly sidebar: boolean;
  readonly onSidebar: () => void;
  readonly onActivate: (id: string) => void;
  readonly onClose: (ids: readonly string[]) => void;
  readonly onReorder: (ids: readonly string[]) => void;
  readonly onNewTab: () => void;
}): ReactElement {
  const ids = tabs.map((tab) => tab.id);

  return (
    <header {...props(titlebarStyles.bar)}>
      <span aria-hidden="true" {...props(styles.lights)}>
        <span {...props(styles.light)} />
        <span {...props(styles.light)} />
        <span {...props(styles.light)} />
      </span>
      <span {...props(titlebarStyles.sidebarSlot, !sidebar && titlebarStyles.sidebarSlotHidden)}>
        <span {...props(titlebarStyles.actionTrack)}>
          <Toggle
            iconOnly
            indicator="glyph"
            aria-label={sidebar ? "Hide sidebar" : "Show sidebar"}
            pressed={sidebar}
            onPressedChange={onSidebar}
          >
            <PanelToggleIcon side="left" visible={sidebar} />
          </Toggle>
        </span>
      </span>
      <div {...props(titlebarStyles.contentArea, titlebarStyles.contentAreaTabbed)}>
        <span {...props(titlebarStyles.center, titlebarStyles.centerTrailing)}>
          <WindowTabStrip
            tabs={tabs}
            activeTabId={active}
            mac
            onActivate={onActivate}
            onClose={(id) => onClose([id])}
            onNewTab={onNewTab}
            onReorder={onReorder}
            onCloseOthers={(id) => onClose(ids.filter((candidate) => candidate !== id))}
            onCloseToRight={(id) => onClose(ids.slice(ids.indexOf(id) + 1))}
          />
        </span>
      </div>
    </header>
  );
}
