import { clientCapabilities } from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { terminalActions } from "../terminal/terminal-store.ts";
import { EDITOR_SLOT, tabSlot, WORKBENCH_KINDS, workbenchShowsChat } from "../workbench/model.ts";
import type { LaunchKind, WorkbenchTabId, WorkbenchViewKey } from "../workbench/model.ts";
import { workbenchScope, workspacePathForView } from "../workbench/paths.ts";
import { dockTabs, shownDockTab, shownWorkbenchTab } from "../workbench/selectors.ts";
import { workbench } from "../workbench/store.ts";

/** Opens a tab of `kind`, a terminal in `folder` when given. Answers the id of the tab it added, or undefined when it added none. */
export function launch(
  view: WorkbenchViewKey,
  kind: LaunchKind,
  folder?: string,
): WorkbenchTabId | undefined {
  const descriptor = WORKBENCH_KINDS[kind];

  if (!descriptor.available(workbenchScope(view), clientCapabilities(nyte.host))) return undefined;
  const tab = { id: crypto.randomUUID(), ...descriptor.launch.input };

  workbench.dispatch(
    view,
    descriptor.launch.policy === "singleton"
      ? { kind: "open", tab, activate: true }
      : { kind: "add", tab },
  );

  if (tab.kind === "terminal") {
    void terminalActions.create({
      id: tab.id,
      workspacePath: folder ?? workspacePathForView(view) ?? null,
    });
  }

  return workbench.getView(view).tabs.some((candidate) => candidate.id === tab.id)
    ? tab.id
    : undefined;
}

/** Shows or hides a Code window's dock. An empty dock opens on a new terminal. */
export function toggleDock(view: WorkbenchViewKey): void {
  const state = workbench.getView(view);
  const scope = workbenchScope(view);
  const capabilities = clientCapabilities(nyte.host);

  const covered = workbenchShowsChat(state.layout);
  const shown = shownDockTab(state, scope, capabilities);

  if (shown !== undefined && !covered) {
    workbench.dispatch(view, { kind: "dock", patch: { open: false } });

    return;
  }

  const tabs = dockTabs(state, scope, capabilities);
  const tab = tabs.find((candidate) => candidate.id === state.dock.active) ?? tabs.at(-1);

  if (tab === undefined) launch(view, "terminal");
  else workbench.dispatch(view, { kind: "activate", id: tab.id });
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
