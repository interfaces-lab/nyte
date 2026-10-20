import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from "@dnd-kit/core";
import type { Announcements, PointerSensorOptions, PointerSensorProps } from "@dnd-kit/core";
import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { createContext, use, useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode, RefObject } from "react";
import { motion } from "@nyte-ai/ui/styles/vars.stylex";
import { useMountEffect } from "../use-mount-effect.ts";

const styles = create({
  sorting: {
    transitionProperty: "transform",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOut,
  },
  dragging: { position: "relative", zIndex: 1, transitionDuration: "0s" },
  shift: (x: number) => ({ transform: `translateX(${x}px)` }),
});

const CONTROL = 'a[href], button, input, select, textarea, [role="button"]';

function grabbable(event: PointerEvent): boolean {
  if (!event.isPrimary || event.button !== 0 || event.ctrlKey) return false;

  const control = event.target instanceof Element ? event.target.closest(CONTROL) : null;

  return control === null || control.getAttribute("role") === "tab";
}

class StripSensor extends PointerSensor {
  constructor(input: PointerSensorProps) {
    const touch = input.event instanceof PointerEvent && input.event.pointerType === "touch";

    super({
      ...input,
      options: { ...input.options, activationConstraint: { distance: touch ? 8 : 4 } },
    });
  }

  static override activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: ReactPointerEvent, options: PointerSensorOptions): boolean => {
        if (!grabbable(nativeEvent)) return false;
        options.onActivation?.({ event: nativeEvent });

        return true;
      },
    },
  ];
}

const silent: Announcements = {
  onDragStart: () => undefined,
  onDragOver: () => undefined,
  onDragEnd: () => undefined,
  onDragCancel: () => undefined,
};

interface Drag {
  readonly id: string;
  readonly order: readonly string[];
  readonly lefts: ReadonlyMap<string, number>;
  readonly widths: ReadonlyMap<string, number>;
  readonly gap: number;
  readonly grabAt: number;
  readonly offset: number;
  readonly from: number;
  readonly target: number;
}

function contentX(list: HTMLElement, clientX: number): number {
  return clientX - list.getBoundingClientRect().left + list.scrollLeft;
}

function startDrag(
  list: HTMLElement,
  items: ReadonlyMap<string, HTMLElement>,
  order: readonly string[],
  id: string,
  clientX: number,
): Drag | undefined {
  const from = order.findIndex((item) => item === id);

  if (from === -1) return undefined;
  const listLeft = list.getBoundingClientRect().left - list.scrollLeft;
  const lefts = new Map<string, number>();
  const widths = new Map<string, number>();

  for (const item of order) {
    const rect = items.get(item)?.getBoundingClientRect();

    if (rect === undefined) return undefined;
    lefts.set(item, rect.left - listLeft);
    widths.set(item, rect.width);
  }

  const [first, second] = order;

  const gap =
    first === undefined || second === undefined
      ? 0
      : (lefts.get(second) ?? 0) - (lefts.get(first) ?? 0) - (widths.get(first) ?? 0);

  return {
    id,
    order,
    lefts,
    widths,
    gap,
    grabAt: contentX(list, clientX),
    offset: 0,
    from,
    target: from,
  };
}

function moveDrag(drag: Drag, list: HTMLElement, clientX: number): Drag {
  const left = drag.lefts.get(drag.id) ?? 0;
  const width = drag.widths.get(drag.id) ?? 0;
  const first = drag.order[0];
  const last = drag.order.at(-1);
  const min = first === undefined ? left : (drag.lefts.get(first) ?? left);

  const max =
    last === undefined
      ? left
      : (drag.lefts.get(last) ?? left) + (drag.widths.get(last) ?? width) - width;

  const placed = Math.min(max, Math.max(min, left + contentX(list, clientX) - drag.grabAt));
  const { from } = drag;

  const readCentre = (id: string): number =>
    (drag.lefts.get(id) ?? 0) + (drag.widths.get(id) ?? 0) / 2;

  const target =
    placed >= left
      ? from +
        drag.order.filter((id, index) => index > from && readCentre(id) < placed + width).length
      : from - drag.order.filter((id, index) => index < from && readCentre(id) > placed).length;

  return { ...drag, offset: placed - left, target };
}

function slideDistance(drag: Drag, id: string): number {
  if (id === drag.id) return drag.offset;

  const { from } = drag;
  const index = drag.order.findIndex((item) => item === id);
  const room = (drag.widths.get(drag.id) ?? 0) + drag.gap;

  if (from < drag.target && index > from && index <= drag.target) return -room;

  if (drag.target < from && index >= drag.target && index < from) return room;

  return 0;
}

interface SortableState {
  readonly drag: Drag | undefined;
  readonly items: Map<string, HTMLElement>;
}

const SortableContext = createContext<SortableState | undefined>(undefined);

export function SortableList({
  ids,
  listRef,
  onPick,
  onReorder,
  children,
}: {
  readonly ids: readonly string[];
  readonly listRef: RefObject<HTMLElement | null>;
  readonly onPick: (id: string) => void;
  readonly onReorder: (order: readonly string[], id: string) => void;
  readonly children: ReactNode;
}): ReactElement {
  const sensors = useSensors(useSensor(StripSensor));
  const [items] = useState(() => new Map<string, HTMLElement>());
  const [drag, setDrag] = useState<Drag | undefined>(undefined);
  const dragRef = useRef<Drag | undefined>(undefined);
  const stopFollowing = useRef<() => void>(() => undefined);

  useMountEffect(() => () => stopFollowing.current());

  const settle = (next: Drag | undefined): void => {
    dragRef.current = next;
    setDrag(next);
  };

  const finish = (): Drag | undefined => {
    const current = dragRef.current;

    stopFollowing.current();
    settle(undefined);

    return current;
  };

  const follow = (list: HTMLElement): void => {
    let clientX: number | undefined;

    const move = (): void => {
      if (dragRef.current !== undefined && clientX !== undefined)
        settle(moveDrag(dragRef.current, list, clientX));
    };

    const point = (event: PointerEvent): void => {
      clientX = event.clientX;
      move();
    };

    window.addEventListener("pointermove", point);
    list.addEventListener("scroll", move);
    stopFollowing.current = () => {
      window.removeEventListener("pointermove", point);
      list.removeEventListener("scroll", move);
      stopFollowing.current = () => undefined;
    };
  };

  return (
    <DndContext
      sensors={sensors}
      accessibility={{ announcements: silent }}
      autoScroll={{
        threshold: { x: 0.05, y: 0 },
        acceleration: 8,
        layoutShiftCompensation: false,
        canScroll: (element) => element === listRef.current,
      }}
      onDragStart={({ active, activatorEvent }) => {
        const list = listRef.current;
        const id = String(active.id);

        if (list === null || !(activatorEvent instanceof MouseEvent)) return;

        const started = startDrag(list, items, ids, id, activatorEvent.clientX);

        if (started === undefined) return;

        settle(started);
        follow(list);
        onPick(id);
      }}
      onDragEnd={() => {
        const current = finish();

        if (current === undefined || current.target === current.from) return;

        if (ids.join("\n") !== current.order.join("\n")) return;

        onReorder(
          current.order.filter((id) => id !== current.id).toSpliced(current.target, 0, current.id),
          current.id,
        );
      }}
      onDragCancel={finish}
    >
      <SortableContext value={{ drag, items }}>{children}</SortableContext>
    </DndContext>
  );
}

export function SortableItem({
  id,
  xstyle,
  children,
}: {
  readonly id: string;
  readonly xstyle?: StyleXStyles;
  readonly children: ReactNode;
}): ReactElement {
  const context = use(SortableContext);

  if (context === undefined) throw new Error("SortableItem must be inside a SortableList");

  const { drag, items } = context;
  const { setNodeRef, listeners } = useDraggable({ id });
  const shift = drag === undefined ? 0 : slideDistance(drag, id);

  const ref = useCallback(
    (element: HTMLDivElement | null): void => {
      setNodeRef(element);

      if (element === null) items.delete(id);
      else items.set(id, element);
    },
    [id, items, setNodeRef],
  );

  return (
    <div
      ref={ref}
      role="presentation"
      {...listeners}
      {...props(
        xstyle,
        drag !== undefined && styles.sorting,
        drag?.id === id && styles.dragging,
        shift !== 0 && styles.shift(shift),
      )}
    >
      {children}
    </div>
  );
}
