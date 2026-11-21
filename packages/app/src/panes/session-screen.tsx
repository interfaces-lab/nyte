import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { props } from "@stylexjs/stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { use, useState } from "react";
import type { ReactElement } from "react";
import { FileTypeIconSprite } from "@nyte-ai/ui/file-type-icon";
import { PaneFloatingMount } from "../chat/chat-pane-view.tsx";
import { LayoutView, PaneGeometry } from "./layout-view.tsx";
import { usePaneLayoutStore } from "./pane-context.tsx";
import { dropPreviewBox } from "./pane-commands.ts";
import type { SessionDropTarget } from "./pane-commands.ts";
import { boxStyle } from "./pane-geometry.ts";
import { renderPaneContent } from "./pane-views.tsx";
import { useSessionDropTarget } from "./session-dnd.tsx";
import { useHostState } from "../data/host.ts";
import { nyte, windowApp } from "../contract/nyte.ts";
import { useNoDesigns } from "../studio/designs.ts";

import { WORKBENCH_CHAT_TAB } from "../workbench/model.ts";
import { activeWorkbenchTab } from "../workbench/selectors.ts";
import { useWorkbenchFolder } from "../workbench/paths.ts";
import { useWorkbenchView } from "../workbench/store.ts";
import { Workbench } from "../workbench/workbench.tsx";
import { useChatWindow } from "../window/index.ts";
import { clientCapabilities } from "../contract/client-actions.ts";

function DropPreview({ target }: { readonly target: SessionDropTarget }): ReactElement | null {
  const box = use(PaneGeometry).panes.get(target.paneId);

  if (box === undefined) return null;

  return (
    <div
      aria-hidden="true"
      data-nyte-drop-preview=""
      {...props(intent.primary, sessionScreenStyles.dropPreview)}
      style={boxStyle(dropPreviewBox(box, target))}
    />
  );
}

function SessionDropPreview(): ReactElement | null {
  const target = useSessionDropTarget();

  return target === undefined ? null : <DropPreview target={target} />;
}

export function SessionScreen(): ReactElement {
  const [floatingMount, setFloatingMount] = useState<HTMLDivElement | null>(null);
  const folder = useWorkbenchFolder(useHostState().data.workspace);
  const workbench = useWorkbenchView(folder?.path);
  const viewKey = workbench.key;
  const view = workbench.view;
  const maximized = view.expanded && view.layout.kind === "maximized";
  const code = windowApp() === "code";

  const covered = useChatWindow((snapshot) => snapshot.covered);
  const store = usePaneLayoutStore();
  const noDesigns = useNoDesigns(folder);
  const shown = activeWorkbenchTab(view, workbench.scope, clientCapabilities(nyte.host))?.kind;

  const paneFloatingMount =
    covered && shown !== "browser" && !(shown === "design" && noDesigns) ? floatingMount : null;

  return (
    <div {...props(sessionScreenStyles.stage)}>
      <FileTypeIconSprite />
      <div
        id={`${viewKey}-panel-${WORKBENCH_CHAT_TAB}`}
        role={maximized ? "tabpanel" : undefined}
        aria-labelledby={maximized ? `${viewKey}-tab-${WORKBENCH_CHAT_TAB}` : undefined}
        inert={covered ? true : undefined}
        {...props(
          sessionScreenStyles.panes,
          covered && sessionScreenStyles.panesCovered,
          code && sessionScreenStyles.panesTrailing,
        )}
      >
        <PaneFloatingMount value={paneFloatingMount}>
          <LayoutView store={store} renderTab={renderPaneContent}>
            <SessionDropPreview />
          </LayoutView>
        </PaneFloatingMount>
      </div>
      <Workbench folder={folder} />
      {!code && <div ref={setFloatingMount} {...props(sessionScreenStyles.floatingMount)} />}
    </div>
  );
}
