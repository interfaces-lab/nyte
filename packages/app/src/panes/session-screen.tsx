import { sessionScreenStyles } from "./session-screen.stylex.ts";
import { props } from "@stylexjs/stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { useState } from "react";
import type { ReactElement } from "react";
import { FileTypeIconSprite } from "@nyte-ai/ui/file-type-icon";
import { PaneFloatingMount } from "../chat/chat-pane-view.tsx";
import type { Layout } from "./layout.ts";
import { LayoutView, PANE_GAP } from "./layout-view.tsx";
import { usePaneLayout, usePaneLayoutStore } from "./pane-context.tsx";
import { boxStyle, layoutGeometry } from "./pane-geometry.ts";
import type { Box, Linear } from "./pane-geometry.ts";
import type { PaneContent } from "./pane-kinds.ts";
import { renderPaneContent } from "./pane-views.tsx";
import { useSessionDropTarget } from "./session-dnd.tsx";
import type { SessionDropTarget } from "./session-dnd.tsx";
import { useHostState } from "../data/host.ts";
import { nyte } from "../contract/nyte.ts";

import { WORKBENCH_CHAT_TAB } from "../workbench/model.ts";
import { activeWorkbenchTab } from "../workbench/selectors.ts";
import { useWorkbenchView } from "../workbench/store.ts";
import { Workbench } from "../workbench/workbench.tsx";
import { useChatWindow } from "../window/index.ts";
import { clientCapabilities } from "../contract/client-actions.ts";

function half(value: Linear): Linear {
  return { px: value.px / 2, fraction: value.fraction / 2, gaps: value.gaps / 2 };
}

function plus(left: Linear, right: Linear): Linear {
  return {
    px: left.px + right.px,
    fraction: left.fraction + right.fraction,
    gaps: left.gaps + right.gaps,
  };
}

function dropPreviewBox(box: Box, target: SessionDropTarget): Box {
  switch (target.placement) {
    case "center":
      return box;
    case "left":
      return { ...box, width: half(box.width) };
    case "right":
      return { ...box, x: plus(box.x, half(box.width)), width: half(box.width) };
    case "top":
      return { ...box, height: half(box.height) };
    case "bottom":
      return { ...box, y: plus(box.y, half(box.height)), height: half(box.height) };
    default: {
      const _exhaustive: never = target.placement;

      return _exhaustive;
    }
  }
}

function DropPreview({ target }: { readonly target: SessionDropTarget }): ReactElement | null {
  const box = usePaneLayout((layout: Layout<PaneContent>) =>
    layoutGeometry(layout).panes.get(target.paneId),
  );

  if (box === undefined) return null;

  return (
    <div
      aria-hidden="true"
      data-nyte-drop-preview=""
      {...props(intent.primary, sessionScreenStyles.dropPreview)}
      style={boxStyle(dropPreviewBox(box, target), PANE_GAP)}
    />
  );
}

function SessionDropPreview(): ReactElement | null {
  const target = useSessionDropTarget();

  return target === undefined ? null : <DropPreview target={target} />;
}

export function SessionScreen(): ReactElement {
  const host = useHostState();
  const [floatingMount, setFloatingMount] = useState<HTMLDivElement | null>(null);
  const workspacePath = host.data.workspace?.path;
  const workbench = useWorkbenchView(workspacePath);
  const viewKey = workbench.key;
  const view = workbench.view;
  const maximized = view.expanded && view.layout.kind === "maximized";

  const covered = useChatWindow((snapshot) => snapshot.covered);
  const store = usePaneLayoutStore();

  const paneFloatingMount =
    covered &&
    activeWorkbenchTab(view, workbench.scope, clientCapabilities(nyte.host))?.kind !== "browser"
      ? floatingMount
      : null;

  return (
    <div {...props(sessionScreenStyles.stage)}>
      <FileTypeIconSprite />
      <div
        id={`${viewKey}-panel-${WORKBENCH_CHAT_TAB}`}
        role={maximized ? "tabpanel" : undefined}
        aria-labelledby={maximized ? `${viewKey}-tab-${WORKBENCH_CHAT_TAB}` : undefined}
        inert={covered ? true : undefined}
        {...props(sessionScreenStyles.panes, covered && sessionScreenStyles.panesCovered)}
      >
        <PaneFloatingMount value={paneFloatingMount}>
          <LayoutView store={store} renderTab={renderPaneContent}>
            <SessionDropPreview />
          </LayoutView>
        </PaneFloatingMount>
      </div>
      <Workbench workspacePath={workspacePath} />
      <div ref={setFloatingMount} {...props(sessionScreenStyles.floatingMount)} />
    </div>
  );
}
