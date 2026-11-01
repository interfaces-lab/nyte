import type { StripTransfer } from "../components/sortable-strip.tsx";
import { nyte } from "../contract/nyte.ts";
import { carriesTab, readTabDrag, startTabDrag } from "../panes/place-drag.ts";
import { movingTab } from "./model.ts";
import { windowTabs } from "./window-tabs.ts";

/**
 * Moves window tabs between windows. A tab another window took leaves this one; a tab dropped
 * where no window is opens in a new window under the pointer, then leaves this one.
 */
export const windowTabTransfer: StripTransfer = {
  start: (tabId, transfer) => {
    const tab = movingTab(windowTabs.getSnapshot(), tabId);

    if (tab !== undefined) startTabDrag(transfer, tab);
  },
  accepts: carriesTab,
  adopt: (transfer, index) => {
    const tab = readTabDrag(transfer);

    if (tab !== undefined) windowTabs.dispatch({ kind: "adopt-tab", tab, index });
  },
  leave: (tabId, event) => {
    const release = (): void => windowTabs.dispatch({ kind: "release-tab", tabId });

    if (event.dataTransfer?.dropEffect === "move") {
      release();

      return;
    }

    const tab = movingTab(windowTabs.getSnapshot(), tabId);
    const tearOff = nyte.host.tearOffTab;

    if (tab === undefined || tearOff === undefined) return;

    void tearOff({ tab: JSON.stringify(tab), x: event.screenX, y: event.screenY }).then(
      (outcome) => {
        if (outcome.kind === "opened") release();
      },
    );
  },
};
