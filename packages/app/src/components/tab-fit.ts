import { useRef, useState } from "react";

/** What a tab strip measures to decide how many of its tabs show; the rest go into its overflow menu. */
export interface TabRoom {
  /** The width the tabs may take, with the overflow button's. */
  readonly width: number;
  /** The active tab's width. It keeps its label, so it never shrinks. */
  readonly active: number;
  /** An inactive tab's narrowest width, with the gap after it. */
  readonly tab: number;
  /** What the overflow button takes once it shows, with its gap: 0 when it always shows. */
  readonly more: number;
}

type Attach = (element: HTMLElement | null) => (() => void) | undefined;

/** How many inactive tabs show beside the active one, each at its narrowest once they don't fit at their widest. */
export function fittingTabs(room: TabRoom | undefined, inactive: number): number {
  if (room === undefined || room.active + inactive * room.tab <= room.width) return inactive;

  return Math.max(0, Math.floor((room.width - room.more - room.active) / room.tab));
}

/** Measures a tab strip with `measure`, which reads the strip it is given and so must not close over render state. */
export function useTabRoom(
  measure: (strip: HTMLElement) => TabRoom | undefined,
): readonly [room: TabRoom | undefined, attachStrip: Attach, attachActive: Attach] {
  const [room, setRoom] = useState<TabRoom>();
  const strip = useRef<HTMLElement>(null);

  const [attach] = useState(() => {
    const update = (): void => {
      const next = strip.current === null ? undefined : measure(strip.current);

      setRoom((current) =>
        current !== undefined &&
        next !== undefined &&
        current.width === next.width &&
        current.active === next.active &&
        current.tab === next.tab &&
        current.more === next.more
          ? current
          : next,
      );
    };

    const watch: Attach = (element) => {
      if (element === null) return undefined;
      const observer = new ResizeObserver(update);
      observer.observe(element);

      return () => observer.disconnect();
    };

    const attachStrip: Attach = (element) => {
      strip.current = element;
      const stop = watch(element);

      return () => {
        stop?.();
        strip.current = null;
      };
    };

    return { strip: attachStrip, active: watch };
  });

  return [room, attach.strip, attach.active];
}

/** A computed length in whole pixels, 0 for `normal` or `auto`. */
export function pixels(length: string): number {
  return Math.ceil(Number.parseFloat(length) || 0);
}
