import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDndContext,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type {
  ClientRect,
  CollisionDetection,
  Data,
  DragEndEvent,
  DroppableContainer,
} from "@dnd-kit/core";
import * as stylex from "@stylexjs/stylex";
import { useCallback, useMemo } from "react";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { ReactElement, ReactNode } from "react";
import type { SessionId } from "@nyte-ai/core";
import { sessionId as sessionIdSchema } from "../../../shared/schemas.ts";
import { t } from "../theme/vars.stylex.ts";
import { usePaneActions, usePaneControllerSnapshot } from "./pane-context.tsx";
import { orderedPanes, paneById } from "./pane-layout.ts";
import type { DropPlacement, PaneId, PaneLayout } from "./pane-layout.ts";
import { placementInRect, SESSION_DRAG_ACTIVATION_DISTANCE } from "./session-dnd-geometry.ts";
import type { SessionDragPoint } from "./session-dnd-geometry.ts";

const DROP_PLACEMENTS = ["center", "top", "bottom", "left", "right"] as const;

const sessionDragDataSchema = Type.Object({
  kind: Type.Literal("session"),
  sessionId: sessionIdSchema,
  title: Type.String(),
});

type SessionDragData = Static<typeof sessionDragDataSchema>;

export interface SessionDropTarget {
  readonly paneId: PaneId;
  readonly placement: DropPlacement;
}

const sessionDropDataSchema = Type.Object({
  kind: Type.Literal("session-pane"),
  paneId: Type.Enum(["primary", "secondary"]),
  placement: Type.Enum(DROP_PLACEMENTS),
});

type SessionDropData = Static<typeof sessionDropDataSchema>;

const styles = stylex.create({
  surface: { display: "contents" },
  overlay: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: "100%",
    paddingInline: 8,
    borderRadius: t.radiusBase,
    backgroundColor: t.bgElevated,
    boxShadow: `${t.shadowPopover}, inset 0 0 0 1px ${t.strokeSecondary}`,
    color: t.textPrimary,
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    cursor: "grabbing",
    pointerEvents: "none",
    userSelect: "none",
  },
  overlayTitle: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function parseSessionDragData(value: Data | undefined): SessionDragData | undefined {
  return Value.Check(sessionDragDataSchema, value) ? value : undefined;
}

function parseSessionDropData(value: Data | undefined): SessionDropData | undefined {
  return Value.Check(sessionDropDataSchema, value) ? value : undefined;
}

function contains(rect: ClientRect, point: SessionDragPoint): boolean {
  return (
    point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom
  );
}

function pointForCollision(
  pointerCoordinates: SessionDragPoint | null,
  collisionRect: ClientRect,
): SessionDragPoint {
  return (
    pointerCoordinates ?? {
      x: collisionRect.left + collisionRect.width / 2,
      y: collisionRect.top + collisionRect.height / 2,
    }
  );
}

function sessionDropId(paneId: PaneId, placement: DropPlacement): string {
  return `session-pane:${paneId}:${placement}`;
}

function matchingDropContainer(
  containers: readonly DroppableContainer[],
  target: SessionDropTarget,
): DroppableContainer | undefined {
  const targetId = sessionDropId(target.paneId, target.placement);
  return containers.find((container) => container.id === targetId);
}

function collisionDetector(layout: PaneLayout): CollisionDetection {
  return ({ active, collisionRect, droppableContainers, droppableRects, pointerCoordinates }) => {
    const dragged = parseSessionDragData(active.data.current);
    if (dragged === undefined) return [];
    const point = pointForCollision(pointerCoordinates, collisionRect);

    for (const pane of orderedPanes(layout)) {
      const paneContainer = matchingDropContainer(droppableContainers, {
        paneId: pane.id,
        placement: "center",
      });
      if (paneContainer === undefined) continue;
      const rect = droppableRects.get(paneContainer.id);
      if (rect === undefined || !contains(rect, point)) continue;
      const currentPane = paneById(layout, pane.id);
      if (
        currentPane?.selection.kind === "session" &&
        currentPane.selection.sessionId === dragged.sessionId
      ) {
        return [];
      }
      const placement = placementInRect(rect, point, layout.kind === "split");
      if (placement === undefined) return [];
      const target = { paneId: pane.id, placement } satisfies SessionDropTarget;
      const container = matchingDropContainer(droppableContainers, target);
      return container === undefined
        ? []
        : [{ id: container.id, data: { droppableContainer: container, value: 0 } }];
    }

    return [];
  };
}

function dropTargetFromEvent(event: DragEndEvent): SessionDropTarget | undefined {
  if (event.over === null) return undefined;
  const data = parseSessionDropData(event.over.data.current);
  return data === undefined ? undefined : { paneId: data.paneId, placement: data.placement };
}

function SessionDragSurface({ children }: { readonly children: ReactNode }): ReactElement {
  const { active } = useDndContext();
  const dragged = parseSessionDragData(active?.data.current);

  return (
    <>
      <div
        data-nyte-session-drag-active={dragged === undefined ? undefined : ""}
        {...stylex.props(styles.surface)}
      >
        {children}
      </div>
      <DragOverlay dropAnimation={null} zIndex={10_000}>
        {dragged === undefined ? null : (
          <div {...stylex.props(styles.overlay)}>
            <span {...stylex.props(styles.overlayTitle)}>{dragged.title}</span>
          </div>
        )}
      </DragOverlay>
    </>
  );
}

/**
 * The row itself is the drag source, so only the pointer sensor is wired: a
 * keyboard sensor would claim Enter and Space before the row's click. Keyboard
 * users split panes from the row's context menu instead.
 */
export function SessionDndProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const { layout } = usePaneControllerSnapshot();
  const panes = usePaneActions();
  const detectCollision = useMemo(() => collisionDetector(layout), [layout]);
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: SESSION_DRAG_ACTIVATION_DISTANCE },
  });
  const sensors = useSensors(pointerSensor);

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const dragged = parseSessionDragData(event.active.data.current);
      const target = dropTargetFromEvent(event);
      if (dragged === undefined || target === undefined) return;
      panes.drop(dragged.sessionId, target.paneId, target.placement);
    },
    [panes],
  );

  return (
    <DndContext
      autoScroll={false}
      collisionDetection={detectCollision}
      sensors={sensors}
      onDragEnd={handleDragEnd}
    >
      <SessionDragSurface>{children}</SessionDragSurface>
    </DndContext>
  );
}

export function useSessionDraggable(sessionId: SessionId, title: string, disabled = false) {
  return useDraggable({
    id: `session:${sessionId}`,
    disabled,
    data: { kind: "session", sessionId, title } satisfies SessionDragData,
  });
}

function usePanePlacement(paneId: PaneId, placement: DropPlacement) {
  return useDroppable({
    id: sessionDropId(paneId, placement),
    data: { kind: "session-pane", paneId, placement } satisfies SessionDropData,
  });
}

export function useSessionPaneDropTarget(paneId: PaneId): (element: HTMLElement | null) => void {
  const { setNodeRef: setCenterNodeRef } = usePanePlacement(paneId, "center");
  const { setNodeRef: setTopNodeRef } = usePanePlacement(paneId, "top");
  const { setNodeRef: setBottomNodeRef } = usePanePlacement(paneId, "bottom");
  const { setNodeRef: setLeftNodeRef } = usePanePlacement(paneId, "left");
  const { setNodeRef: setRightNodeRef } = usePanePlacement(paneId, "right");

  return useCallback(
    (element: HTMLElement | null): void => {
      setCenterNodeRef(element);
      setTopNodeRef(element);
      setBottomNodeRef(element);
      setLeftNodeRef(element);
      setRightNodeRef(element);
    },
    [setBottomNodeRef, setCenterNodeRef, setLeftNodeRef, setRightNodeRef, setTopNodeRef],
  );
}

export function useSessionDropTarget(): SessionDropTarget | undefined {
  const { active, over } = useDndContext();
  const dragged = parseSessionDragData(active?.data.current);
  if (dragged === undefined || over === null) return undefined;
  const target = parseSessionDropData(over.data.current);
  return target === undefined ? undefined : { paneId: target.paneId, placement: target.placement };
}
