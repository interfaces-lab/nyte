import { threadStyles } from "./thread.stylex.ts";
import { PaneHost } from "./pane-host.tsx";
import { SplitSash } from "./split-sash.tsx";
import { props } from "@stylexjs/stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import { FileTypeIconSprite } from "../components/file-type-icon.tsx";
import { usePaneControllerSnapshot } from "../layout/pane-context.tsx";
import { activePane, orderedPanes } from "../layout/pane-layout.ts";
import type { PaneId, PaneLayout } from "../layout/pane-layout.ts";
import { useSessionDropTarget } from "../layout/session-dnd.tsx";
import type { SessionDropTarget } from "../layout/session-dnd.tsx";
import { useHostState } from "../queries.ts";
import { nyte } from "../nyte.ts";

import {
  activeWorkbenchTab,
  useWorkbenchSnapshot,
  workbenchController,
  workbenchScope,
  workbenchShowsChat,
  workbenchViewKey,
  WORKBENCH_CHAT_TAB,
} from "../workbench/controller.ts";
import { Workbench } from "../workbench/workbench.tsx";
import { clientCapabilities } from "../client-actions.ts";

function panePreviewRect(
  layout: Extract<PaneLayout, { kind: "split" }>,
  paneId: PaneId,
): CSSProperties {
  const leading = layout.leading === paneId;
  const leadingSize = `${String(layout.ratio * 100)}%`;
  const trailingSize = `${String((1 - layout.ratio) * 100)}%`;

  if (layout.direction === "right") {
    return {
      top: 0,
      left: leading ? 0 : leadingSize,
      width: leading ? leadingSize : trailingSize,
      height: "100%",
    };
  }

  return {
    top: leading ? 0 : leadingSize,
    left: 0,
    width: "100%",
    height: leading ? leadingSize : trailingSize,
  };
}

function dropPreviewRect(layout: PaneLayout, target: SessionDropTarget): CSSProperties {
  const leadingSize = layout.kind === "single" ? "50%" : `${String(layout.ratio * 100)}%`;
  const trailingSize = layout.kind === "single" ? "50%" : `${String((1 - layout.ratio) * 100)}%`;

  switch (target.placement) {
    case "top":
      return { top: 0, left: 0, width: "100%", height: leadingSize };
    case "bottom":
      return { top: leadingSize, left: 0, width: "100%", height: trailingSize };
    case "left":
      return { top: 0, left: 0, width: leadingSize, height: "100%" };
    case "right":
      return { top: 0, left: leadingSize, width: trailingSize, height: "100%" };
    case "center":
      return layout.kind === "single"
        ? { top: 0, left: 0, width: "100%", height: "100%" }
        : panePreviewRect(layout, target.paneId);
    default: {
      const _exhaustive: never = target.placement;

      return _exhaustive;
    }
  }
}

function DropPreview({
  layout,
  target,
}: {
  readonly layout: PaneLayout;
  readonly target: SessionDropTarget;
}): ReactElement {
  return (
    <div aria-hidden="true" {...props(threadStyles.dropPreviewLayer)}>
      <div
        data-nyte-drop-preview=""
        {...props(intent.primary, threadStyles.dropPreview)}
        style={dropPreviewRect(layout, target)}
      />
    </div>
  );
}

/**
 * One workspace-lifetime stage for blank and session places. The active tab's
 * panes decide what it shows; the route follows them.
 */
export function ThreadScreen(): ReactElement {
  const { layout } = usePaneControllerSnapshot();
  const host = useHostState();
  const containerRef = useRef<HTMLDivElement>(null);
  const [floatingMount, setFloatingMount] = useState<HTMLDivElement | null>(null);
  const workbench = useWorkbenchSnapshot();
  const dropTarget = useSessionDropTarget();
  const [dragRatio, setDragRatio] = useState<number | undefined>();
  const panes = orderedPanes(layout);
  const leading = panes[0] ?? activePane(layout);
  const trailing = layout.kind === "split" ? panes[1] : undefined;
  const activeSelection = activePane(layout).selection;
  const workspacePath = host.data.workspace?.path;

  const viewKey = workbenchViewKey(workspacePath);
  const view = workbench.views.get(viewKey) ?? workbenchController.getView(viewKey);
  const maximized = view.expanded && view.layout.kind === "maximized";
  const chatShowing = maximized && workbenchShowsChat(view.layout);

  const paneFloatingMount =
    maximized &&
    !chatShowing &&
    activeWorkbenchTab(view, workbenchScope(workspacePath), clientCapabilities(nyte.host))?.kind !==
      "browser"
      ? floatingMount
      : null;

  return (
    <div {...props(threadStyles.stage)}>
      <FileTypeIconSprite />
      <div
        ref={containerRef}
        id={`${viewKey}-panel-${WORKBENCH_CHAT_TAB}`}
        role={maximized ? "tabpanel" : undefined}
        aria-labelledby={maximized ? `${viewKey}-tab-${WORKBENCH_CHAT_TAB}` : undefined}
        {...props(
          threadStyles.panes,
          layout.kind === "split" &&
            (layout.direction === "right" ? threadStyles.splitRight : threadStyles.splitDown),
        )}
      >
        <PaneHost
          key={leading.id}
          pane={leading}
          floatingMount={paneFloatingMount}
          position={
            layout.kind === "single"
              ? { kind: "single" }
              : { kind: "leading", ratio: dragRatio ?? layout.ratio }
          }
        />
        {layout.kind === "split" && trailing !== undefined && (
          <SplitSash
            key="pane-sash"
            direction={layout.direction}
            ratio={layout.ratio}
            dragRatio={dragRatio}
            onDragRatio={setDragRatio}
            containerRef={containerRef}
          />
        )}
        {layout.kind === "split" && trailing !== undefined && (
          <PaneHost
            key={trailing.id}
            pane={trailing}
            position={{ kind: "trailing" }}
            floatingMount={paneFloatingMount}
          />
        )}
        {dropTarget !== undefined && <DropPreview layout={layout} target={dropTarget} />}
      </div>
      <Workbench
        workspacePath={workspacePath}
        sessionId={activeSelection.kind === "session" ? activeSelection.sessionId : undefined}
      />
      <div ref={setFloatingMount} {...props(threadStyles.floatingMount)} />
    </div>
  );
}
