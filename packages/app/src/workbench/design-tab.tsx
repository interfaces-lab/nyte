import type { ReactElement } from "react";
import { useHostState } from "../data/host.ts";
import { DesignPanel } from "../studio/design-panel.tsx";
import { windowTabs } from "../tabs/window-tabs.ts";
import { useWorkbenchViewKey } from "./paths.ts";
import { workbench } from "./store.ts";
import { useWorkbenchWorkspace } from "./workbench-workspace.tsx";

/** The Design tab: the designs of the workspace the workbench is browsing. */
export function DesignTab(): ReactElement {
  const browsed = useWorkbenchWorkspace();
  const view = useWorkbenchViewKey(useHostState().data.workspace?.path);

  return (
    <DesignPanel
      workspace={browsed.kind === "ready" ? browsed.workspace : undefined}
      onAsk={() => {
        if (workbench.getView(view).layout.kind === "maximized")
          workbench.dispatch(view, { kind: "toggle-maximized" });
        const layout = windowTabs.panes().layout;
        layout.requestFocus(layout.getSnapshot().focus[0]);
      }}
    />
  );
}
