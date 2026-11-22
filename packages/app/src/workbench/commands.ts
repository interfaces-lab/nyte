import type { JobView, WorkspaceId } from "@nyte-ai/sdk";
import { clientCapabilities } from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { EDITOR_SLOT, FOLLOW_BROWSE, matchingTab, tabSlot, WORKBENCH_KINDS } from "./model.ts";
import type {
  LaunchKind,
  WorkbenchChangesScope,
  WorkbenchTabId,
  WorkbenchViewKey,
} from "./model.ts";
import { workbenchScope, workspacePathForView } from "./paths.ts";
import { shownWorkbenchTab } from "./selectors.ts";
import { workbench } from "./store.ts";
import { terminalActions } from "../terminal/terminal-store.ts";

export function launch(view: WorkbenchViewKey, kind: LaunchKind): void {
  const descriptor = WORKBENCH_KINDS[kind];

  if (!descriptor.available(workbenchScope(view), clientCapabilities(nyte.host))) return;
  const tab = { id: crypto.randomUUID(), ...descriptor.launch.input };

  workbench.dispatch(
    view,
    descriptor.launch.policy === "singleton"
      ? { kind: "open", tab, activate: true }
      : { kind: "add", tab },
  );

  if (tab.kind === "terminal") {
    void terminalActions.create({ id: tab.id, workspacePath: workspacePathForView(view) ?? null });
  }
}

/** Shows or hides a Code window's explorer. Another tab covering the Editor gives way to it with the explorer open. */
export function toggleExplorer(view: WorkbenchViewKey): void {
  const state = workbench.getView(view);

  const shown = shownWorkbenchTab(state, workbenchScope(view), clientCapabilities(nyte.host));

  const open = state.sidebars.includes(EDITOR_SLOT);

  if (shown !== null && tabSlot(shown) === EDITOR_SLOT) {
    workbench.dispatch(view, { kind: "toggle-sidebar", slot: EDITOR_SLOT });

    return;
  }

  launch(view, "editor");

  if (!open) workbench.dispatch(view, { kind: "toggle-sidebar", slot: EDITOR_SLOT });
}

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

export function openJobTerminal(
  view: WorkbenchViewKey,
  workspace: WorkspaceId,
  job: JobView,
): WorkbenchTabId {
  const input = { kind: "terminal", owner: { kind: "job", workspace, job: job.id } } as const;
  const id = matchingTab(workbench.getView(view).tabs, input)?.id ?? crypto.randomUUID();
  workbench.dispatch(view, { kind: "open", tab: { id, ...input }, activate: true });
  terminalActions.openJob({ id, workspace, job });

  return id;
}
