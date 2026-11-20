import { useEffectEvent } from "react";
import type { RefObject } from "react";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { navigates, navigatesUp, scrollsWithin } from "./transcript-scroll.ts";

export function ViewportInput({
  viewport,
  content,
  onPresent,
  onResize,
  onHold,
  onInput,
  onPress,
  onSelectionChange,
}: {
  readonly viewport: HTMLDivElement;
  readonly content: RefObject<HTMLDivElement | null>;
  readonly onPresent: () => void;
  readonly onResize: (height: number) => void;
  readonly onHold: (element: Element) => void;
  readonly onInput: (upward: boolean) => void;
  readonly onPress: (pressed: boolean) => void;
  readonly onSelectionChange: () => void;
}): null {
  const present = useEffectEvent(onPresent);
  const resized = useEffectEvent(onResize);
  const hold = useEffectEvent(onHold);
  const input = useEffectEvent(onInput);
  const press = useEffectEvent(onPress);
  const select = useEffectEvent(onSelectionChange);

  useMountEffect(() => {
    const resize = new ResizeObserver(() => resized(viewport.clientHeight));
    resize.observe(viewport);
    let touchY = 0;

    const pressed = (event: PointerEvent): void => {
      if (event.target !== viewport) return;
      press(true);
      input(false);
    };

    const keyed = (event: KeyboardEvent): void => {
      if (navigates(event)) input(navigatesUp(event));
    };

    const touched = (event: TouchEvent): void => {
      const y = event.touches[0]?.clientY ?? touchY;
      input(y > touchY);
      touchY = y;
    };

    const clicked = (event: MouseEvent): void => {
      const control =
        event.target instanceof Element
          ? event.target.closest("[aria-expanded], [data-step-preview] *")
          : null;

      if (control !== null) hold(control);
    };

    const listeners = new AbortController();
    const signal = listeners.signal;
    viewport.addEventListener("scroll", () => present(), { passive: true, signal });
    viewport.addEventListener("wheel", (event) => input(event.deltaY < 0), {
      passive: true,
      signal,
    });
    viewport.addEventListener(
      "touchstart",
      (event) => {
        touchY = event.touches[0]?.clientY ?? 0;
      },
      { passive: true, signal },
    );
    viewport.addEventListener("touchmove", touched, { passive: true, signal });
    viewport.addEventListener("pointerdown", pressed, { signal });
    window.addEventListener("pointerup", () => press(false), { signal });
    window.addEventListener("pointercancel", () => press(false), { signal });
    viewport.addEventListener("keydown", keyed, { signal });
    content.current?.addEventListener("click", clicked, { capture: true, signal });
    document.addEventListener("selectionchange", () => select(), { signal });

    return () => {
      listeners.abort();
      resize.disconnect();
    };
  });

  return null;
}

export function DockInput({
  dock,
  onResize,
  onWheel,
}: {
  readonly dock: HTMLDivElement;
  readonly onResize: (height: number) => void;
  readonly onWheel: (delta: number) => void;
}): null {
  const resized = useEffectEvent(onResize);
  const wheeled = useEffectEvent(onWheel);

  useMountEffect(() => {
    const resize = new ResizeObserver(() => resized(dock.getBoundingClientRect().height));
    resize.observe(dock);
    resized(dock.getBoundingClientRect().height);

    const listeners = new AbortController();

    dock.addEventListener(
      "wheel",
      (event) => {
        if (!scrollsWithin(event.target, dock)) wheeled(event.deltaY);
      },
      { passive: true, signal: listeners.signal },
    );

    return () => {
      listeners.abort();
      resize.disconnect();
    };
  });

  return null;
}
