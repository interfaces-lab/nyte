import { createTerminal } from "@nyte-ai/vt";
import type { CellSize, Cursor, Engine, Terminal } from "@nyte-ai/vt";
import { preferences } from "../../preferences/index.ts";
import { colorScheme, terminalAppearance } from "./terminal-appearance.ts";
import { createRenderer, measureCell } from "./terminal-renderer.ts";

const BLINK_MS = 600;

export interface TerminalSurface {
  readonly terminal: Terminal;
  readonly canvas: HTMLCanvasElement;
  /** One cell in CSS pixels. */
  cell(): CellSize;
  /** Paints on the next frame; `full` repaints every row. */
  draw(full: boolean): void;
  /** Sizes the canvas and the grid to `element`, once it's laid out. */
  fit(): void;
  /** Starts drawing into `element`. */
  show(): void;
  /** Stops drawing and frees the canvas's backing store. */
  hide(): void;
  /** Whether the cursor draws as focused, and blinks. */
  focus(focused: boolean): void;
  /** Shows the cursor and restarts its blink, as typing does. */
  restartBlink(): void;
  dispose(): void;
}

export interface SurfaceOptions {
  /** Whether the terminal draws its cursor, as a shell does and command output doesn't. */
  readonly cursor: boolean;
  readonly newlineMode: boolean;
  readonly reply: (bytes: Uint8Array) => void;
  readonly title: (title: string) => void;
  /** After each paint, with the frame's cursor. */
  readonly painted: (cursor: Cursor | null) => void;
  /** After the grid changes size. */
  readonly resized: () => void;
}

/**
 * A libghostty-vt terminal drawn on a canvas in `element`, in the app's theme, code font and
 * cursor preferences, and kept current as they change. Nothing draws until `show`.
 */
export async function openTerminalSurface(
  engine: Engine,
  element: HTMLElement,
  options: SurfaceOptions,
): Promise<TerminalSurface> {
  let appearance = terminalAppearance();
  let signature = JSON.stringify(appearance);
  let ratio = window.devicePixelRatio;
  let metrics = measureCell(appearance.font, ratio);
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.left = "0";
  canvas.style.top = "0";
  canvas.style.display = "block";
  element.append(canvas);
  const renderer = createRenderer(canvas);
  renderer.setFont(appearance.font, metrics);
  let shown = false;
  let focused = false;
  let frame = 0;
  let full = true;
  let blinkTimer: ReturnType<typeof setInterval> | undefined;
  let blinkOn = true;

  const cell = (): CellSize => ({ width: metrics.width / ratio, height: metrics.height / ratio });

  let sizedCell = cell();

  const cursor = () => ({
    style: preferences.terminalCursorStyle.get(),
    blink: preferences.terminalCursorBlink.get(),
  });

  const terminal = await createTerminal(engine, {
    cols: 80,
    rows: 24,
    cell: sizedCell,
    scrollback: preferences.terminalScrollback.get(),
    palette: appearance.palette,
    cursor: cursor(),
    newlineMode: options.newlineMode,
    effects: { reply: options.reply, title: options.title, colorScheme },
  });

  const stopBlink = (): void => {
    clearInterval(blinkTimer);
    blinkTimer = undefined;
    blinkOn = true;
  };

  const startBlink = (): void => {
    stopBlink();
    blinkTimer = setInterval(() => {
      blinkOn = !blinkOn;
      draw(false);
    }, BLINK_MS);
  };

  const paint = (): void => {
    frame = 0;

    if (!shown) return;
    const next = terminal.frame(full);
    full = false;

    const shownCursor =
      !options.cursor || next.cursor === null || (focused && next.cursor.blinking && !blinkOn)
        ? "hidden"
        : focused
          ? "focused"
          : "unfocused";

    renderer.paint(next, { cursor: shownCursor, selection: appearance.selection });
    const blinks = shown && focused && options.cursor && next.cursor?.blinking === true;

    if (blinks !== (blinkTimer !== undefined)) {
      if (blinks) startBlink();
      else stopBlink();
    }

    options.painted(next.cursor);
  };

  const draw = (repaint: boolean): void => {
    full = full || repaint;

    if (shown && frame === 0) frame = requestAnimationFrame(paint);
  };

  const fit = (): void => {
    if (!element.isConnected || element.clientWidth === 0 || element.clientHeight === 0) return;
    const box = element.getBoundingClientRect();
    const width = Math.floor(box.width * ratio);
    const height = Math.floor(box.height * ratio);

    if (canvas.width !== width || canvas.height !== height) {
      renderer.resize(width, height);
      draw(true);
    }

    const cols = Math.min(1000, Math.max(2, Math.floor(width / metrics.width)));
    const rows = Math.min(1000, Math.max(1, Math.floor(height / metrics.height)));
    const size = cell();

    if (
      cols === terminal.cols &&
      rows === terminal.rows &&
      size.width === sizedCell.width &&
      size.height === sizedCell.height
    )
      return;
    sizedCell = size;
    terminal.resize(cols, rows, size);
    draw(true);
    options.resized();
  };

  let fitFrame = 0;

  const scheduleFit = (): void => {
    cancelAnimationFrame(fitFrame);
    fitFrame = requestAnimationFrame(fit);
  };

  const remeasure = (): void => {
    ratio = window.devicePixelRatio;
    metrics = measureCell(appearance.font, ratio);
    renderer.setFont(appearance.font, metrics);
    scheduleFit();
    draw(true);
  };

  const resize = new ResizeObserver(scheduleFit);
  resize.observe(element);
  const root = document.documentElement;

  const restyle = new MutationObserver(() => {
    const next = terminalAppearance();
    const nextSignature = JSON.stringify(next);

    if (nextSignature === signature) return;
    appearance = next;
    signature = nextSignature;
    terminal.setPalette(next.palette);
    terminal.colorSchemeChanged(next.scheme);
    remeasure();
  });

  restyle.observe(root, {
    attributes: true,
    attributeFilter: ["style", "class", "data-display-mode"],
  });
  let resolution = window.matchMedia(`(resolution: ${String(ratio)}dppx)`);

  const resolutionChanged = (): void => {
    resolution.removeEventListener("change", resolutionChanged);
    resolution = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    resolution.addEventListener("change", resolutionChanged);
    remeasure();
  };

  resolution.addEventListener("change", resolutionChanged);

  const restyleCursor = (): void => {
    terminal.setCursor(cursor());
    draw(false);
  };

  const stopCursorStyle = preferences.terminalCursorStyle.subscribe(restyleCursor);
  const stopCursorBlink = preferences.terminalCursorBlink.subscribe(restyleCursor);

  const stopScrollback = preferences.terminalScrollback.subscribe(() => {
    terminal.setScrollback(preferences.terminalScrollback.get());
    draw(true);
  });

  document.fonts.addEventListener("loadingdone", remeasure);

  return {
    terminal,
    canvas,
    cell,
    draw,
    fit,
    show() {
      shown = true;
      fit();
      draw(true);
    },
    hide() {
      shown = false;
      focused = false;
      cancelAnimationFrame(frame);
      frame = 0;
      stopBlink();
      renderer.release();
    },
    focus(value) {
      focused = value;
      draw(false);
    },
    restartBlink() {
      if (blinkTimer !== undefined) startBlink();
      draw(false);
    },
    dispose() {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(fitFrame);
      stopBlink();
      resize.disconnect();
      restyle.disconnect();
      resolution.removeEventListener("change", resolutionChanged);
      stopCursorStyle();
      stopCursorBlink();
      stopScrollback();
      document.fonts.removeEventListener("loadingdone", remeasure);
      shown = false;
      terminal.dispose();
      canvas.remove();
    },
  };
}
