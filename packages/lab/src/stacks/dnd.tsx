import { useDndContext, useDraggable, useDroppable } from "@dnd-kit/core";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { motion, role } from "@nyte-ai/ui/styles/vars.stylex";

/** A chat being dragged carries its id; anything that takes it drops it on a stack. */
export const CHAT = "chat:";

export const STACK = "stack:";

const styles = create({
  zone: {
    position: "relative",
    borderRadius: radius.control,
    transitionProperty: "box-shadow, background-color",
    transitionDuration: motion.durationFast,
  },
  ready: { boxShadow: `inset 0 0 0 1px ${role.borderSecondaryTranslucent}` },
  over: {
    backgroundColor: role.bgInteractivePrimaryTranslucent,
    boxShadow: `inset 0 0 0 1px ${role.contentInteractivePrimary}`,
  },
  dragging: { opacity: 0.5 },
});

/** Somewhere a chat can land; it lights up only while a chat is in the air. */
export function DropZone({
  stack,
  label,
  children,
}: {
  readonly stack: string;
  readonly label: string;
  readonly children: ReactNode;
}): ReactElement {
  const { active, isOver, setNodeRef } = useDroppable({ id: `${STACK}${stack}:${label}` });
  const carrying = active !== null && String(active.id).startsWith(CHAT);

  return (
    <div
      ref={setNodeRef}
      {...props(styles.zone, carrying && styles.ready, carrying && isOver && styles.over)}
    >
      {children}
    </div>
  );
}

export function DraggableChat({
  chat,
  children,
}: {
  readonly chat: string;
  readonly children: ReactNode;
}): ReactElement {
  const { attributes, isDragging, listeners, setNodeRef } = useDraggable({ id: `${CHAT}${chat}` });

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} {...props(isDragging && styles.dragging)}>
      {children}
    </div>
  );
}

/** The stack a drop landed on, read back from a drop zone's id. */
export function droppedOn(id: string | number | undefined): string | null {
  if (id === undefined || !String(id).startsWith(STACK)) return null;

  return String(id).slice(STACK.length).split(":")[0] ?? null;
}

export function useCarrying(): string | null {
  const context = useDndContext();
  const id = context.active?.id;

  if (id === undefined || !String(id).startsWith(CHAT)) return null;

  return String(id).slice(CHAT.length);
}
