/**
 * A host that paints something above the DOM, such as a native view, needs to
 * know which floating surfaces are open so it can step aside. Every popup and
 * backdrop in this package attaches the provided ref callback; without a
 * provider nothing is attached.
 */
import { createContext, use, useEffect, useRef } from "react";
import type { PointerEvent, ReactElement, ReactNode } from "react";

/** A React 19 ref callback: called with the mounted element, returns its cleanup. */
export type OverlayRef = (element: Element | null) => (() => void) | undefined;

const OverlayRefContext = createContext<OverlayRef | undefined>(undefined);

export interface OverlayRefProviderProps {
  readonly value: OverlayRef;
  readonly children: ReactNode;
}

export function OverlayRefProvider({ value, children }: OverlayRefProviderProps): ReactElement {
  return <OverlayRefContext value={value}>{children}</OverlayRefContext>;
}

/** Pass the result as `ref` on a popup, positioner-less panel, or backdrop. */
export function useOverlayRef(): OverlayRef | undefined {
  return use(OverlayRefContext);
}

export function useLongPressPreview(open: () => void, disabled = false) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const opened = useRef(false);

  const cancel = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };

  useEffect(() => () => clearTimeout(timer.current), [disabled]);

  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      cancel();
      opened.current = false;
      if (disabled || event.pointerType === "mouse" || !event.isPrimary || event.button !== 0) {
        return;
      }
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = setTimeout(() => {
        opened.current = true;
        open();
      }, 500);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel() {
      cancel();
      opened.current = false;
    },
    onContextMenu(event: { preventDefault(): void }) {
      if (opened.current) event.preventDefault();
    },
    onClickCapture(event: { preventDefault(): void; stopPropagation(): void }) {
      if (!opened.current) return;
      opened.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
