/**
 * Drag-to-reorder for a horizontal strip, with opencode's rules: an item moves
 * after 4px (8 on touch), only sideways and only inside its list; pressing a
 * control inside an item never starts a drag; picking an item up selects it;
 * the drop lands without an animation; Escape cancels; and the list scrolls
 * near its edges. Fixed items neither move nor take a dragged item.
 */
import { DndContext, PointerSensor, useDraggable, useSensor, useSensors } from "@dnd-kit/core";
import type { Announcements, PointerSensorOptions, PointerSensorProps } from "@dnd-kit/core";
import { create, props } from "@stylexjs/stylex";
import type { StyleXStyles } from "@stylexjs/stylex";
import { createContext, use, useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement, ReactNode, RefObject } from "react";
import { motion } from "@nyte-ai/ui/vars.stylex";
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
  /** The item under the pointer follows it exactly; only its neighbours ease aside. */
  dragging: { position: "relative", zIndex: 1, transitionDuration: "0s" },
  shift: (x: number) => ({ transform: `translateX(${x}px)` }),
});

/** A control inside an item keeps its own press; the tab itself may be a button. */
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

/** Positions are in the list's scrolled content, so a scroll mid-drag cannot shift the maths. */
interface Drag {
  readonly id: string;
  readonly order: readonly string[];
  readonly lefts: ReadonlyMap<string, number>;
  readonly widths: ReadonlyMap<string, number>;
  readonly gap: number;
  readonly grabAt: number;
  readonly offset: number;
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
    target: order.indexOf(id),
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
  const from = drag.order.indexOf(drag.id);

  const centreOf = (id: string): number =>
    (drag.lefts.get(id) ?? 0) + (drag.widths.get(id) ?? 0) / 2;

  // A neighbour gives way once the leading edge of the dragged item passes its centre.
  const target =
    placed >= left
      ? from +
        drag.order.filter((id, index) => index > from && centreOf(id) < placed + width).length
      : from - drag.order.filter((id, index) => index < from && centreOf(id) > placed).length;

  return { ...drag, offset: placed - left, target };
}

/** How far an item slides to make room while another passes it. */
function shiftOf(drag: Drag, id: string): number {
  if (id === drag.id) return drag.offset;

  const from = drag.order.indexOf(drag.id);
  const index = drag.order.indexOf(id);
  const room = (drag.widths.get(drag.id) ?? 0) + drag.gap;

  if (from < drag.target && index > from && index <= drag.target) return -room;

  if (drag.target < from && index >= drag.target && index < from) return room;

  return 0;
}

interface SortableState {
  readonly drag: Drag | undefined;
  readonly fixed: ReadonlySet<string>;
  readonly items: Map<string, HTMLElement>;
}

const SortableContext = createContext<SortableState | undefined>(undefined);

const NONE: ReadonlySet<string> = new Set();

export function SortableList({
  ids,
  fixed = NONE,
  listRef,
  onPick,
  onReorder,
  children,
}: {
  readonly ids: readonly string[];
  /** Items that hold their place. */
  readonly fixed?: ReadonlySet<string>;
  /** The scrolling list the items live in. */
  readonly listRef: RefObject<HTMLElement | null>;
  readonly onPick: (id: string) => void;
  /** The full new order, and the item that moved; fixed items keep their places. */
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

  /** The pointer and the list's scroll both move the item, so either recomputes it. */
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

        const order = ids.filter((item) => !fixed.has(item));
        const started = startDrag(list, items, order, id, activatorEvent.clientX);

        if (started === undefined) return;

        settle(started);
        follow(list);
        onPick(id);
      }}
      onDragEnd={() => {
        const current = finish();

        if (current === undefined || current.target === current.order.indexOf(current.id)) return;

        if (ids.filter((id) => !fixed.has(id)).join("\n") !== current.order.join("\n")) return;

        const moved = current.order
          .filter((id) => id !== current.id)
          .toSpliced(current.target, 0, current.id);

        onReorder(
          ids.map((id) => (fixed.has(id) ? id : (moved.shift() ?? id))),
          current.id,
        );
      }}
      onDragCancel={finish}
    >
      <SortableContext value={{ drag, fixed, items }}>{children}</SortableContext>
    </DndContext>
  );
}

/** One item of a `SortableList`: the element that moves, and that a press picks up. */
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

  const { drag, fixed, items } = context;
  const { setNodeRef, listeners } = useDraggable({ id, disabled: fixed.has(id) });
  const shift = drag === undefined ? 0 : shiftOf(drag, id);

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
