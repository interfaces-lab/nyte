import type { CellSize, MouseButton, MouseInput, SelectionInput, Terminal } from "@nyte-ai/vt";

export interface PointerHost {
  readonly terminal: Terminal;
  readonly canvas: HTMLCanvasElement;
  cell(): CellSize;
  tracking(): boolean;
  send(bytes: Uint8Array): void;
  focus(): void;
  selecting(): void;
  settled(): void;
  scrolled(): void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

const BUTTONS: readonly MouseButton[] = ["left", "middle", "right"];

const WHEEL_LIMIT = 5;

export function attachPointer(host: PointerHost): () => void {
  const terminal = host.terminal;
  const canvas = host.canvas;
  const page = canvas.ownerDocument;
  let dragging: "select" | "report" | null = null;
  let pressed: MouseButton | null = null;
  let remainderX = 0;
  let remainderY = 0;

  const point = (event: MouseEvent): Point => {
    const box = canvas.getBoundingClientRect();

    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const report = (
    event: MouseEvent,
    action: MouseInput["action"],
    button: MouseButton | null,
  ): void => {
    const at = point(event);

    host.send(
      terminal.mouse({
        action,
        button,
        x: at.x,
        y: at.y,
        shift: event.shiftKey,
        ctrl: event.ctrlKey,
        alt: event.altKey,
        meta: event.metaKey,
      }),
    );
  };

  const select = (event: MouseEvent, action: SelectionInput["action"]): void => {
    const at = point(event);
    const cell = host.cell();

    if (action === "drag" && at.y < 0) terminal.scroll(-1);

    if (action === "drag" && at.y > terminal.rows * cell.height) terminal.scroll(1);
    const x = Math.min(terminal.cols * cell.width - 1, Math.max(0, at.x));
    const y = Math.min(terminal.rows * cell.height - 1, Math.max(0, at.y));
    terminal.select({
      action,
      col: Math.floor(x / cell.width),
      row: Math.floor(y / cell.height),
      x,
      y,
      time: event.timeStamp,
      rectangle: event.altKey,
    });
    host.selecting();
  };

  const move = (event: MouseEvent): void => {
    if (dragging === "select") select(event, "drag");

    if (dragging === "report") report(event, "motion", pressed);
  };

  const up = (event: MouseEvent): void => {
    page.removeEventListener("mousemove", move);
    page.removeEventListener("mouseup", up);

    if (dragging === "select") {
      select(event, "release");
      host.settled();
    }

    if (dragging === "report") report(event, "release", pressed);
    dragging = null;
    pressed = null;
  };

  const down = (event: MouseEvent): void => {
    event.preventDefault();
    host.focus();

    if (dragging !== null) return;
    const button = BUTTONS[event.button] ?? null;

    const reporting = host.tracking() && !event.shiftKey;

    if (reporting ? button === null : event.button !== 0) return;
    dragging = reporting ? "report" : "select";
    pressed = reporting ? button : null;

    if (reporting) report(event, "press", button);
    else {
      select(event, "press");
      host.settled();
    }

    page.addEventListener("mousemove", move);
    page.addEventListener("mouseup", up);
  };

  const hover = (event: MouseEvent): void => {
    if (dragging === null && host.tracking()) report(event, "motion", null);
  };

  const lines = (delta: number, mode: number, remainder: number, size: number) => {
    if (mode === WheelEvent.DOM_DELTA_LINE) return { whole: Math.trunc(delta), remainder: 0 };

    if (mode === WheelEvent.DOM_DELTA_PAGE)
      return { whole: Math.trunc(delta * terminal.rows), remainder: 0 };
    const total = remainder + delta / size;

    return { whole: Math.trunc(total), remainder: total - Math.trunc(total) };
  };

  const wheel = (event: WheelEvent): void => {
    event.preventDefault();
    const cell = host.cell();
    const vertical = lines(event.deltaY, event.deltaMode, remainderY, cell.height);
    const horizontal = lines(event.deltaX, event.deltaMode, remainderX, cell.width);
    remainderY = vertical.remainder;
    remainderX = horizontal.remainder;

    if (host.tracking() && !event.shiftKey) {
      const notches: readonly MouseButton[] = [
        ...Array.from({ length: Math.min(WHEEL_LIMIT, Math.abs(vertical.whole)) }, () =>
          vertical.whole < 0 ? "wheel-up" : "wheel-down",
        ),
        ...Array.from({ length: Math.min(WHEEL_LIMIT, Math.abs(horizontal.whole)) }, () =>
          horizontal.whole < 0 ? "wheel-left" : "wheel-right",
        ),
      ];

      notches.forEach((button) => report(event, "press", button));

      return;
    }

    if (vertical.whole === 0) return;

    if (terminal.alternateScroll()) {
      const code = vertical.whole < 0 ? "ArrowUp" : "ArrowDown";

      Array.from({ length: Math.min(WHEEL_LIMIT, Math.abs(vertical.whole)) }).forEach(() =>
        host.send(
          terminal.key({
            action: "press",
            code,
            key: code,
            shift: false,
            ctrl: false,
            alt: false,
            meta: false,
            composing: false,
            optionAsAlt: false,
          }),
        ),
      );

      return;
    }

    terminal.scroll(vertical.whole);
    host.scrolled();
  };

  canvas.addEventListener("mousedown", down);
  canvas.addEventListener("mousemove", hover);
  canvas.addEventListener("wheel", wheel, { passive: false });

  return () => {
    canvas.removeEventListener("mousedown", down);
    canvas.removeEventListener("mousemove", hover);
    canvas.removeEventListener("wheel", wheel);
    page.removeEventListener("mousemove", move);
    page.removeEventListener("mouseup", up);
  };
}
