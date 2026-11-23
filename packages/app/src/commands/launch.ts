import { clientCapabilities } from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { terminalActions } from "../terminal/terminal-store.ts";
import { EDITOR_SLOT, tabSlot, WORKBENCH_KINDS } from "../workbench/model.ts";
import type { LaunchKind, WorkbenchViewKey } from "../workbench/model.ts";
import { workbenchScope, workspacePathForView } from "../workbench/paths.ts";
import { shownWorkbenchTab } from "../workbench/selectors.ts";
import { workbench } from "../workbench/store.ts";

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
