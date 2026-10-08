/**
 * The rail beside a workbench tab's main content: the changes tree, the
 * browser's visit history, the files explorer. One persisted width serves
 * all of them, written to the root as a CSS variable so a drag never waits
 * for React. The seat owns the border, the width, and the resize handle.
 */
import { create, props } from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { sidebar, workbench } from "../theme/schema.stylex.ts";
import { role } from "@nyte-ai/ui/vars.stylex";
import { workbenchStyles } from "./workbench.stylex.ts";

const WIDTH_DEFAULT = 200;

const WIDTH_MIN = 160;

const WIDTH_MAX = 560;

const WIDTH_STEP = 8;

/** The main content keeps at least this much, whatever the rail asks for. */
const MAIN_WIDTH_MIN = 240;

const STORAGE_KEY = "nyte.desktop.workbench-rail-width.v1";

const WIDTH_VARIABLE = "--nyte-workbench-file-list-width";

function clampWidth(width: number, max: number): number {
  if (!Number.isFinite(width)) return WIDTH_DEFAULT;

  return Math.min(max, Math.max(WIDTH_MIN, Math.round(width)));
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function applyWidth(width: number): void {
  document.documentElement.style.setProperty(WIDTH_VARIABLE, `${String(width)}px`);
}

let width = clampWidth(Number(storage()?.getItem(STORAGE_KEY) ?? WIDTH_DEFAULT), WIDTH_MAX);

applyWidth(width);

const listeners = new Set<() => void>();

function setWidth(next: number): void {
  if (next === width) return;
  width = next;
  applyWidth(next);

  try {
    storage()?.setItem(STORAGE_KEY, String(next));
  } catch {
    // The in-memory choice still applies for this window.
  }

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
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
    borderInlineStartColor: role.borderSecondaryTranslucent,
    backgroundColor: role.bgBase,
  },
  sash: {
    insetInlineEnd: "auto",
    insetInlineStart: 0,
    width: sidebar.handleWidth,
    "::after": { insetInlineEnd: "auto", insetInlineStart: 0 },
  },
});

interface ResizeState {
  readonly pointerId: number;
  readonly startX: number;
  readonly startWidth: number;
  nextWidth: number;
}

export function WorkbenchRail({ children }: { readonly children: ReactNode }): ReactElement {
  const current = useSyncExternalStore(subscribe, () => width);
  const seatRef = useRef<HTMLDivElement>(null);
  const [max, setMax] = useState(WIDTH_MAX);
  const [resizing, setResizing] = useState(false);
  const resizeRef = useRef<ResizeState | undefined>(undefined);

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
    resize.nextWidth = clampWidth(resize.startWidth + resize.startX - event.clientX, max);
    applyWidth(resize.nextWidth);
  };

  const endResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;

    if (resize === undefined || resize.pointerId !== event.pointerId) return;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    resizeRef.current = undefined;
    setWidth(resize.nextWidth);
    setResizing(false);
  };

  const cancelResize = (event: PointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;

    if (resize === undefined || resize.pointerId !== event.pointerId) return;
    resizeRef.current = undefined;
    applyWidth(resize.startWidth);
    setResizing(false);
  };

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>): void => {
    let next: number | undefined;
    const step = event.shiftKey ? WIDTH_STEP * 4 : WIDTH_STEP;

    if (event.key === "ArrowLeft") next = current + step;
    else if (event.key === "ArrowRight") next = current - step;
    else if (event.key === "Home") next = WIDTH_MIN;
    else if (event.key === "End") next = max;

    if (next === undefined) return;
    event.preventDefault();
    setWidth(clampWidth(next, max));
  };

  return (
    <div ref={seatRef} {...props(styles.seat)}>
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize side panel"
        aria-orientation="vertical"
        aria-valuemin={WIDTH_MIN}
        aria-valuemax={max}
        aria-valuenow={current}
        {...props(workbenchStyles.sash, styles.sash, resizing && workbenchStyles.sashActive)}
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
