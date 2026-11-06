import { create, props } from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { sidebar, workbench } from "../theme/schema.stylex.ts";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { Type } from "typebox";
import { persisted } from "../lib/storage.ts";
import { workbenchStyles } from "./workbench.stylex.ts";

const WIDTH_DEFAULT = 200;

const WIDTH_MIN = 160;

const WIDTH_MAX = 560;

const WIDTH_STEP = 8;

const MAIN_WIDTH_MIN = 240;

const WIDTH_VARIABLE = "--nyte-workbench-file-list-width";

function clampWidth(width: number, max: number): number {
  if (!Number.isFinite(width)) return WIDTH_DEFAULT;

  return Math.min(max, Math.max(WIDTH_MIN, Math.round(width)));
}

function applyWidth(width: number): void {
  document.documentElement.style.setProperty(WIDTH_VARIABLE, `${String(width)}px`);
}

const storedWidth = persisted(
  "nyte.desktop.workbench-rail-width.v1",
  Type.Number({ minimum: WIDTH_MIN, maximum: WIDTH_MAX }),
  WIDTH_DEFAULT,
);

applyWidth(storedWidth.get());

function setWidth(next: number): void {
  if (next === storedWidth.get()) return;
  applyWidth(next);
  storedWidth.set(next);
}

const styles = create({
  seat: {
    order: 1,
    position: "relative",
    display: "flex",
    flexDirection: "column",
    width: workbench.fileListWidth,
    maxWidth: `calc(100% - ${String(MAIN_WIDTH_MIN)}px)`,
    flexShrink: 0,
    minHeight: 0,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: role.strokeQuaternary,
    backgroundColor: role.bgBase,
  },
  sash: {
    insetInlineEnd: "auto",
    insetInlineStart: 0,
    width: sidebar.handleWidth,
    "::after": { insetInlineEnd: "auto", insetInlineStart: 0 },
  },
  seatStart: {
    order: -1,
    borderInlineStartWidth: 0,
    borderInlineEndWidth: 1,
    borderInlineEndStyle: "solid",
    borderInlineEndColor: role.strokeQuaternary,
  },
  sashStart: {
    insetInlineStart: "auto",
    insetInlineEnd: 0,
    "::after": { insetInlineStart: "auto", insetInlineEnd: 0 },
  },
});

function widthGrowth(seat: HTMLElement | null, side: "start" | "end"): 1 | -1 {
  const rtl = seat !== null && getComputedStyle(seat).direction === "rtl";

  return (side === "end") !== rtl ? 1 : -1;
}

interface ResizeState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  nextWidth: number;
}

export function SidePanel({
  side = "end",
  children,
}: {
  readonly side?: "start" | "end";
  readonly children: ReactNode;
}): ReactElement {
  const current = useSyncExternalStore(storedWidth.subscribe, storedWidth.get);
  const seatRef = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(WIDTH_MAX);
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<ResizeState | undefined>(undefined);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the row before paint and observes its size
  useLayoutEffect(() => {
    const row = seatRef.current?.parentElement;

    if (row === undefined || row === null) return;

    const sync = (): void =>
      setMax(Math.max(WIDTH_MIN, Math.min(WIDTH_MAX, row.clientWidth - MAIN_WIDTH_MIN)));

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(row);

    return () => observer.disconnect();
  }, []);

  const growth = (): 1 | -1 => widthGrowth(seatRef.current, side);

  const beginResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: current,
      nextWidth: current,
    };
    setResizing(true);
  };

  const moveResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;

    if (resize === undefined || resize.pointerId !== event.pointerId) return;
    resize.nextWidth = clampWidth(
      resize.startWidth + (resize.startX - event.clientX) * growth(),
      max,
    );
    seatRef.current?.style.setProperty("width", `${String(resize.nextWidth)}px`);
  };

  const endResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;

    if (resize === undefined || resize.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resizeRef.current = undefined;
    setWidth(resize.nextWidth);
    seatRef.current?.style.removeProperty("width");
    setResizing(false);
  };

  const cancelResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;

    if (resize === undefined || resize.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    seatRef.current?.style.removeProperty("width");
    setResizing(false);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next: number | undefined;
    const step = (event.shiftKey ? WIDTH_STEP * 4 : WIDTH_STEP) * growth();

    if (event.key === "ArrowLeft") next = current + step;
    else if (event.key === "ArrowRight") next = current - step;
    else if (event.key === "Home") next = WIDTH_MIN;
    else if (event.key === "End") next = max;

    if (next === undefined) return;
    event.preventDefault();
    setWidth(clampWidth(next, max));
  };

  return (
    <div ref={seatRef} {...props(styles.seat, side === "start" && styles.seatStart)}>
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize side panel"
        aria-orientation="vertical"
        aria-valuemin={WIDTH_MIN}
        aria-valuemax={max}
        aria-valuenow={current}
        {...props(
          workbenchStyles.sash,
          styles.sash,
          side === "start" && styles.sashStart,
          resizing && workbenchStyles.sashActive,
        )}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={beginResize}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={cancelResize}
      />
      {children}
    </div>
  );
}
