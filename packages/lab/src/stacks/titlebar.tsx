import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { titlebarStyles } from "@nyte-ai/app/chrome/titlebar.stylex.ts";
import { WindowTabStrip } from "@nyte-ai/app/tabs/window-tab-strip.tsx";
import type { WindowTabItem } from "@nyte-ai/app/tabs/window-tab-strip.tsx";
import { PanelToggleIcon } from "@nyte-ai/ui/icon";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { styles as shell } from "../projects/page.stylex";

const styles = create({
  trailing: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    paddingInlineEnd: space.s2,
    WebkitAppRegion: "no-drag",
  },
});

/** The app's titlebar with one tab: the stack, or the item open in it. */
export function Titlebar({
  tab,
  docked,
  open,
  trailing,
  onSidebar,
  onClose,
}: {
  readonly tab: WindowTabItem;
  readonly trailing?: ReactNode;
  /** The sidebar shares the row, so its slot keeps the sidebar's width. */
  readonly docked: boolean;
  readonly open: boolean;
  readonly onSidebar: () => void;
  readonly onClose: () => void;
}): ReactElement {
  return (
    <header {...props(titlebarStyles.bar)}>
      <span aria-hidden="true" {...props(shell.lights)}>
        <span {...props(shell.light)} />
        <span {...props(shell.light)} />
        <span {...props(shell.light)} />
      </span>
      <span {...props(titlebarStyles.sidebarSlot, !docked && titlebarStyles.sidebarSlotHidden)}>
        <span {...props(titlebarStyles.actionTrack)}>
          <Toggle
            iconOnly
            indicator="glyph"
            aria-label={open ? "Hide sidebar" : "Show sidebar"}
            pressed={open}
            onPressedChange={onSidebar}
          >
            <PanelToggleIcon side="left" visible={open} />
          </Toggle>
        </span>
      </span>
      <div {...props(titlebarStyles.contentArea, titlebarStyles.contentAreaTabbed)}>
        <span {...props(titlebarStyles.center, titlebarStyles.centerTrailing)}>
          <WindowTabStrip
            tabs={[tab]}
            activeTabId={tab.id}
            mac
            onActivate={() => undefined}
            onClose={onClose}
            onNewTab={onClose}
            onReorder={() => undefined}
            onCloseOthers={() => undefined}
            onCloseToRight={() => undefined}
          />
        </span>
        {trailing !== undefined && <span {...props(styles.trailing)}>{trailing}</span>}
      </div>
    </header>
  );
}
