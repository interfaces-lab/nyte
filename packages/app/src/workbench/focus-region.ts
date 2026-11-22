import { workbenchShowsChat } from "./model.ts";
import type { WorkbenchViewState } from "./model.ts";

let lastRegion: "panes" | "workbench" = "panes";

/** Records which region the person used last, from the target of a focus or a press. Elsewhere, such as the titlebar, the sidebar or a dialog, leaves it as it was. */
export function noteFocusRegion(target: EventTarget | null): void {
  if (!(target instanceof Element)) return;

  if (target.closest("[data-nyte-workbench], [data-nyte-browser-guests]") !== null) {
    lastRegion = "workbench";

    return;
  }

  if (target.closest("[data-nyte-pane-id]") !== null) lastRegion = "panes";
}

/** Whether the person is in the workbench: it shows, and either covers the panes or was the region used last. */
export function workbenchHasFocus(view: WorkbenchViewState): boolean {
  if (!view.expanded || workbenchShowsChat(view.layout)) return false;

  if (view.layout.kind === "maximized") return true;

  return lastRegion === "workbench";
}
