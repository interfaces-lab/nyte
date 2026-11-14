import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
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
import { create, props } from "@stylexjs/stylex";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import type { ReactElement, ReactNode } from "react";
import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { sessionId as sessionIdSchema } from "../data/schemas.ts";
import { role, shadow } from "@nyte-ai/ui/styles/vars.stylex";
import { usePaneActions, usePaneLayoutStore } from "./pane-context.tsx";
import type { PaneId } from "./layout.ts";
import type { LayoutStore } from "./layout-store.ts";
import { dropTarget } from "./pane-commands.ts";
import type { SessionDropTarget } from "./pane-commands.ts";
import { chatPanes } from "./pane-layout.ts";
import { occludes } from "../components/overlay-occlusion.ts";
import type { DropPlacement } from "./pane-layout.ts";
import { SESSION_DRAG_ACTIVATION_DISTANCE } from "./session-dnd-geometry.ts";
import type { SessionDragPoint } from "./session-dnd-geometry.ts";

const DROP_PLACEMENTS = ["center", "top", "bottom", "left", "right"] as const;

const sessionDragDataSchema = Type.Object({
  kind: Type.Literal("session"),
  sessionId: sessionIdSchema,
  title: Type.String(),
});

type SessionDragData = Static<typeof sessionDragDataSchema>;

const sessionDropDataSchema = Type.Object({
  kind: Type.Literal("session-pane"),
  paneId: Type.String({ minLength: 1 }),
  placement: Type.Enum(DROP_PLACEMENTS),
});

type SessionDropData = Static<typeof sessionDropDataSchema>;

const styles = create({
  surface: { display: "contents" },
  overlay: {
    display: "flex",
    alignItems: "center",
    width: "100%",
    height: "100%",
    paddingInline: space.s2,
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    color: role.contentPrimary,
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

function collisionDetector(store: LayoutStore): CollisionDetection {
  return ({ active, collisionRect, droppableContainers, droppableRects, pointerCoordinates }) => {
    const dragged = parseSessionDragData(active.data.current);

    if (dragged === undefined) return [];
    const layout = store.getSnapshot();

    const rects = new Map(
      chatPanes(layout).flatMap((pane) => {
        const container = matchingDropContainer(droppableContainers, {
          paneId: pane.pane,
          placement: "center",
        });

        const rect = container === undefined ? undefined : droppableRects.get(container.id);

        return rect === undefined ? [] : [[pane.pane, rect] as const];
      }),
    );

    const target = dropTarget(
      layout,
      rects,
      pointForCollision(pointerCoordinates, collisionRect),
      dragged.sessionId,
      window.innerWidth,
    );

    const container =
      target === undefined ? undefined : matchingDropContainer(droppableContainers, target);

    return container === undefined
      ? []
      : [{ id: container.id, data: { droppableContainer: container, value: 0 } }];
  };
}

function dropTargetFromEvent(event: DragEndEvent): SessionDropTarget | undefined {
  if (event.over === null) return undefined;
  const data = parseSessionDropData(event.over.data.current);

  return data === undefined
    ? undefined
    : { paneId: asId<"pane">(data.paneId), placement: data.placement };
}

function SessionDragSurface({ children }: { readonly children: ReactNode }): ReactElement {
  const { active } = useDndContext();
  const dragged = parseSessionDragData(active?.data.current);

  return (
    <>
      <div
        data-nyte-session-drag-active={dragged === undefined ? undefined : ""}
        {...props(styles.surface)}
      >
        {children}
      </div>
      <DragOverlay dropAnimation={null} zIndex={10_000}>
        {dragged === undefined ? null : (
          <div ref={occludes} data-slot="drag-overlay" {...props(text.base, styles.overlay)}>
            <span {...props(styles.overlayTitle)}>{dragged.title}</span>
          </div>
        )}
      </DragOverlay>
    </>
  );
}

export function SessionDndProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const store = usePaneLayoutStore();
  const panes = usePaneActions();
  const detectCollision = collisionDetector(store);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: SESSION_DRAG_ACTIVATION_DISTANCE },
  });

  const sensors = useSensors(pointerSensor);

  const handleDragEnd = (event: DragEndEvent): void => {
    const dragged = parseSessionDragData(event.active.data.current);
    const target = dropTargetFromEvent(event);

    if (dragged === undefined || target === undefined) return;
    panes.drop(dragged.sessionId, target.paneId, target.placement);
  };

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

  return (element: HTMLElement | null): void => {
    setCenterNodeRef(element);
    setTopNodeRef(element);
    setBottomNodeRef(element);
    setLeftNodeRef(element);
    setRightNodeRef(element);
  };
}

export function useSessionDropTarget(): SessionDropTarget | undefined {
  const { active, over } = useDndContext();
  const dragged = parseSessionDragData(active?.data.current);

  if (dragged === undefined || over === null) return undefined;
  const target = parseSessionDropData(over.data.current);

  return target === undefined
    ? undefined
    : { paneId: asId<"pane">(target.paneId), placement: target.placement };
}
