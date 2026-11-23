import { FOLLOW_BROWSE } from "./model.ts";
import type { WorkbenchChangesScope, WorkbenchViewKey } from "./model.ts";
import { workbench } from "./store.ts";

/** Shows a Code window's chat panel: beside the editor, or in its place where the window is too narrow for both. */
export function revealChatPanel(view: WorkbenchViewKey): void {
  const layout = workbench.getView(view).layout;

  if (layout.kind === "maximized") {
    workbench.dispatch(view, { kind: layout.narrow ? "show-chat" : "toggle-maximized" });
  }
}

export function openUrl(view: WorkbenchViewKey, url: string, activate = true): void {
  workbench.dispatch(view, {
    kind: "open",
    tab: { id: crypto.randomUUID(), kind: "browser", url, surface: null },
    activate,
  });
}

export function openChanges(
  view: WorkbenchViewKey,
  scope: WorkbenchChangesScope,
  path: string | null,
): void {
  workbench.dispatch(view, { kind: "browse", root: FOLLOW_BROWSE });
  workbench.dispatch(view, { kind: "open-changes", id: crypto.randomUUID(), scope, path });
}
