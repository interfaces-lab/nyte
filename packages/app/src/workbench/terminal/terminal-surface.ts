import { createTerminal } from "@nyte-ai/vt";
import type { CellSize, Cursor, Engine, Terminal } from "@nyte-ai/vt";
import { preferences } from "../../preferences/index.ts";
import { colorScheme, terminalAppearance } from "./terminal-appearance.ts";
import type { TerminalLink } from "./terminal-links.ts";
import { createRenderer, measureCell } from "./terminal-renderer.ts";

const BLINK_MS = 600;

const HELD_REDRAW_MS = 1050;

/** A grid of `cols` by `rows` cells of `cell` CSS pixels. */
interface GridSize {
  readonly cols: number;
  readonly rows: number;
  readonly cell: CellSize;
}

export interface TerminalSurface {
  readonly terminal: Terminal;
  readonly canvas: HTMLCanvasElement;
  cell(): CellSize;
  draw(full: boolean): void;
  fit(): void;
  /** The grid the element holds, as last measured. */
  fitted(): GridSize;
  /** Gives the terminal a new grid, reflowing its lines. */
  resize(size: GridSize): void;
  show(): void;
  hide(): void;
  focus(focused: boolean): void;
  restartBlink(): void;
  showLink(link: TerminalLink | null): void;
  dispose(): void;
}

export interface SurfaceOptions {
  /**
   * What sizes the grid: the element, at once, or a program's terminal, whose grid waits for `resize` until the program
   * has the new size, so output it wrote for one width never lands in a grid of another.
   */
  readonly grid: "element" | "program";
  readonly cursor: "shell" | "none" | "always";
  readonly newlineMode: boolean;
  readonly reply: (bytes: Uint8Array) => void;
  readonly title: (title: string) => void;
  readonly painted: (cursor: Cursor | null) => void;
  /** The grid the element holds changed. */
  readonly resized: () => void;
}

type Repaint = "none" | "changed" | "full";

type Restyle = "none" | "appearance" | "metrics";

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
  let tick = 0;
  let repaint: Repaint = "full";
  let restyle: Restyle = "none";
  let blinkTimer: ReturnType<typeof setInterval> | undefined;
  let blinkOn = true;
  let link: TerminalLink | null = null;
  let heldTimer: ReturnType<typeof setTimeout> | undefined;

  const cell = (): CellSize => ({ width: metrics.width / ratio, height: metrics.height / ratio });

  let fitted: GridSize = { cols: 80, rows: 24, cell: cell() };

  let grid = fitted;

  const cursor = () => ({
    style: preferences.terminalCursorStyle.get(),
    blink: preferences.terminalCursorBlink.get(),
  });

  const terminal = await createTerminal(engine, {
    cols: fitted.cols,
    rows: fitted.rows,
    cell: fitted.cell,
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

  const applyRestyle = (): void => {
    if (restyle === "none") return;
    const forced = restyle === "metrics";
    restyle = "none";
    const next = terminalAppearance();
    const nextSignature = JSON.stringify(next);
    const changed = nextSignature !== signature;

    if (!changed && !forced) return;

    if (changed) {
      if (next.scheme !== appearance.scheme) terminal.colorSchemeChanged(next.scheme);
      appearance = next;
      signature = nextSignature;
      terminal.setPalette(next.palette);
    }

    ratio = window.devicePixelRatio;
    metrics = measureCell(appearance.font, ratio);
    renderer.setFont(appearance.font, metrics);
    repaint = "full";
  };

  const applyLayout = (): void => {
    if (!element.isConnected || element.clientWidth === 0 || element.clientHeight === 0) return;
    const box = element.getBoundingClientRect();
    const width = Math.floor(box.width * ratio);
    const height = Math.floor(box.height * ratio);

    if (canvas.width !== width || canvas.height !== height) {
      renderer.resize(width, height);
      repaint = "full";
    }

    const next = {
      cols: Math.min(1000, Math.max(2, Math.floor(width / metrics.width))),
      rows: Math.min(1000, Math.max(1, Math.floor(height / metrics.height))),
      cell: cell(),
    };

    if (sameGrid(next, fitted)) return;
    fitted = next;

    if (options.grid === "element") resizeGrid(next);
    options.resized();
  };

  const resizeGrid = (size: GridSize): void => {
    if (sameGrid(size, grid)) return;
    grid = size;
    terminal.resize(size.cols, size.rows, size.cell);
    draw(true);
  };

  const paint = (): void => {
    const next = terminal.frame(repaint === "full");
    repaint = "none";

    const active = focused || options.cursor === "always";

    const shownCursor =
      options.cursor === "none" ||
      next.cursor === null ||
      (active && next.cursor.blinking && !blinkOn)
        ? "hidden"
        : active
          ? "focused"
          : "unfocused";

    renderer.paint(next, terminal.screen, {
      cursor: shownCursor,
      selection: appearance.selection,
      link,
    });
    const blinks = active && options.cursor !== "none" && next.cursor?.blinking === true;

    if (blinks !== (blinkTimer !== undefined)) {
      if (blinks) startBlink();
      else stopBlink();
    }

    clearTimeout(heldTimer);
    heldTimer = next.held ? setTimeout(() => draw(false), HELD_REDRAW_MS) : undefined;
    options.painted(next.cursor);
  };

  const render = (): void => {
    cancelAnimationFrame(tick);
    tick = 0;
    applyRestyle();

    if (!shown) return;
    applyLayout();

    if (repaint !== "none") paint();
  };

  const schedule = (): void => {
    if (tick === 0) tick = requestAnimationFrame(render);
  };

  const draw = (full: boolean): void => {
    repaint = full || repaint === "full" ? "full" : "changed";

    if (shown) schedule();
  };

  const requestRestyle = (next: Exclude<Restyle, "none">): void => {
    restyle = restyle === "metrics" ? "metrics" : next;
    schedule();
  };

  const resize = new ResizeObserver(render);
  resize.observe(element);

  const restyleObserver = new MutationObserver(() => requestRestyle("appearance"));

  restyleObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["style", "class", "data-display-mode"],
  });
  let resolution = window.matchMedia(`(resolution: ${String(ratio)}dppx)`);

  const resolutionChanged = (): void => {
    resolution.removeEventListener("change", resolutionChanged);
    resolution = window.matchMedia(`(resolution: ${String(window.devicePixelRatio)}dppx)`);
    resolution.addEventListener("change", resolutionChanged);
    requestRestyle("metrics");
  };

  resolution.addEventListener("change", resolutionChanged);

  const fontsLoaded = (): void => requestRestyle("metrics");

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

  document.fonts.addEventListener("loadingdone", fontsLoaded);

  return {
    terminal,
    canvas,
    cell,
    draw,
    fit: render,
    fitted: () => fitted,
    resize: resizeGrid,
    show() {
      shown = true;
      render();
    },
    hide() {
      shown = false;
      focused = false;
      cancelAnimationFrame(tick);
      tick = 0;
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
    restartBlink() {
      if (blinkTimer !== undefined) startBlink();
      draw(false);
    },
    dispose() {
      cancelAnimationFrame(tick);
      clearTimeout(heldTimer);
      stopBlink();
      resize.disconnect();
      restyleObserver.disconnect();
      resolution.removeEventListener("change", resolutionChanged);
      stopCursorStyle();
      stopCursorBlink();
      stopScrollback();
      document.fonts.removeEventListener("loadingdone", fontsLoaded);
      shown = false;
      terminal.dispose();
      canvas.remove();
    },
  };
}

function sameGrid(first: GridSize, second: GridSize): boolean {
  return (
    first.cols === second.cols &&
    first.rows === second.rows &&
    first.cell.width === second.cell.width &&
    first.cell.height === second.cell.height
  );
}
