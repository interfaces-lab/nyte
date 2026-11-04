import { createTerminal } from "@nyte-ai/vt";
import type { CellSize, Cursor, Engine, Row, Terminal } from "@nyte-ai/vt";
import { preferences } from "../../preferences/index.ts";
import { colorScheme, terminalAppearance } from "./terminal-appearance.ts";
import type { TerminalLink } from "./terminal-links.ts";
import { createRenderer, measureCell } from "./terminal-renderer.ts";

const BLINK_MS = 600;

/** Past libghostty-vt's one-second hold limit, so the redraw lands after the hold is released. */
const HELD_REDRAW_MS = 1_050;

export interface TerminalSurface {
  readonly terminal: Terminal;
  readonly canvas: HTMLCanvasElement;
  /** One cell in CSS pixels. */
  cell(): CellSize;
  /** Paints on the next frame; `full` repaints every row. */
  draw(full: boolean): void;
  /**
   * Sizes the canvas and the grid to `element`, once it's laid out, and paints at once: resizing
   * clears the opaque canvas to black, which a paint on the next frame would show for a frame on
   * every frame of an animated resize.
   */
  fit(): void;
  /** Starts drawing into `element`. */
  show(): void;
  /** Stops drawing and frees the canvas's backing store. */
  hide(): void;
  /** Whether the cursor draws as focused, and blinks. */
  focus(focused: boolean): void;
  /** Shows the cursor and restarts its blink, as typing does. */
  restartBlink(): void;
  /** Underlines `link`, or nothing, from the next paint. */
  showLink(link: TerminalLink | null): void;
  /** The row on screen at viewport row `y`. */
  row(y: number): Row | undefined;
  dispose(): void;
}

export interface SurfaceOptions {
  /** A shell draws its cursor hollow while unfocused, command output draws none, and a preview always draws it as focused. */
  readonly cursor: "shell" | "none" | "always";
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
  const renderer = createRenderer(canvas);
  renderer.setFont(appearance.font, metrics);
  let shown = false;
  let focused = false;
  let frame = 0;
  let full = true;
  let blinkTimer: ReturnType<typeof setInterval> | undefined;
  let blinkOn = true;
  let link: TerminalLink | null = null;
  let heldTimer: ReturnType<typeof setTimeout> | undefined;

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

  element.append(canvas);

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

    const active = focused || options.cursor === "always";

    const shownCursor =
      options.cursor === "none" ||
      next.cursor === null ||
      (active && next.cursor.blinking && !blinkOn)
        ? "hidden"
        : active
          ? "focused"
          : "unfocused";

    renderer.paint(next, { cursor: shownCursor, selection: appearance.selection, link });
    const blinks = active && options.cursor !== "none" && next.cursor?.blinking === true;

    if (blinks !== (blinkTimer !== undefined)) {
      if (blinks) startBlink();
      else stopBlink();
    }

    clearTimeout(heldTimer);
    heldTimer = next.held ? setTimeout(() => draw(false), HELD_REDRAW_MS) : undefined;
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
    const resized = canvas.width !== width || canvas.height !== height;

    if (resized) renderer.resize(width, height);

    const cols = Math.min(1000, Math.max(2, Math.floor(width / metrics.width)));
    const rows = Math.min(1000, Math.max(1, Math.floor(height / metrics.height)));
    const size = cell();

    const regridded =
      cols !== terminal.cols ||
      rows !== terminal.rows ||
      size.width !== sizedCell.width ||
      size.height !== sizedCell.height;

    if (regridded) {
      sizedCell = size;
      terminal.resize(cols, rows, size);
      options.resized();
    }

    if (!resized && !regridded) return;
    full = true;
    cancelAnimationFrame(frame);
    paint();
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

  let restyleFrame = 0;

  const readAppearance = (): void => {
    restyleFrame = 0;
    const next = terminalAppearance();
    const nextSignature = JSON.stringify(next);

    if (nextSignature === signature) return;
    const schemeChanged = next.scheme !== appearance.scheme;
    appearance = next;
    signature = nextSignature;
    terminal.setPalette(next.palette);

    if (schemeChanged) terminal.colorSchemeChanged(next.scheme);
    remeasure();
  };

  const restyle = new MutationObserver(() => {
    if (restyleFrame === 0) restyleFrame = requestAnimationFrame(readAppearance);
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
      clearTimeout(heldTimer);
      stopBlink();
      renderer.release();
    },
    focus(value) {
      focused = value;
      draw(false);
    },
    showLink(next) {
      if (JSON.stringify(next) === JSON.stringify(link)) return;
      link = next;
      draw(false);
    },
    row: (y) => renderer.row(y),
    restartBlink() {
      if (blinkTimer !== undefined) startBlink();
      draw(false);
    },
    dispose() {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(fitFrame);
      cancelAnimationFrame(restyleFrame);
      clearTimeout(heldTimer);
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
