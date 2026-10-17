import { FitAddon, Ghostty, Terminal } from "ghostty-web";
import type { ITheme } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";
import { serial } from "@nyte-ai/schema/serial";
import { toast } from "@nyte-ai/ui/toast";
import { preferences } from "../preferences/index.ts";
import { errorMessage } from "../errors.ts";
import { props } from "@stylexjs/stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  attachTerminalOutput,
  getTerminal,
  terminalActions,
  terminalPrinted,
} from "./terminal-store.ts";
import type { TerminalTab } from "./terminal-store.ts";

interface TerminalView {
  readonly element: HTMLDivElement;
  readonly terminal: Terminal;
  fit(): void;
}

let ghostty: Promise<Ghostty> | undefined;

const views = new Map<string, TerminalView>();

function loadGhostty(): Promise<Ghostty> {
  ghostty ??= Ghostty.load(wasmUrl).catch((cause: unknown) => {
    ghostty = undefined;
    throw cause;
  });

  return ghostty;
}

/** Canvas terminals need resolved sRGB values, not CSS variables or color-mix expressions. */
function terminalAppearance() {
  const probe = document.createElement("span");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("Canvas rendering is unavailable");
  document.documentElement.append(probe);

  const resolve = (value: string, scope?: Tint): string => {
    probe.className = scope === undefined ? "" : (props(surfaceTheme[scope]).className ?? "");
    probe.style.color = value;

    return getComputedStyle(probe).color;
  };

  const background = resolve(role.bgBase);

  const color = (value: string, scope?: Tint): string => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = background;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = resolve(value, scope);
    context.fillRect(0, 0, 1, 1);

    return (
      "#" +
      [...context.getImageData(0, 0, 1, 1).data]
        .slice(0, 3)
        .map((value) => value.toString(16).padStart(2, "0"))
        .join("")
    );
  };

  try {
    const page = color(role.bgBase);
    const ink = color(role.contentPrimary);
    const dark = document.documentElement.dataset["displayMode"] === "dark";
    const black = dark ? page : ink;
    const white = dark ? ink : page;
    probe.style.fontFamily = type.fontMono;
    probe.style.fontSize = type.fontCode;
    const font = getComputedStyle(probe);
    const fontFamily = font.fontFamily;
    const fontSize = Number.parseFloat(font.fontSize);

    const theme = {
      background: page,
      foreground: ink,
      cursor: ink,
      selectionBackground: color(role.bgInteractivePrimaryTranslucent),
      black,
      red: color(role.contentSecondary, "red"),
      green: color(role.contentSecondary, "green"),
      yellow: color(role.contentSecondary, "yellow"),
      blue: color(role.contentSecondary, "blue"),
      magenta: color(role.contentSecondary, "pink"),
      cyan: color(role.contentSecondary, "teal"),
      white,
      brightBlack: color(role.contentSecondary, "gray"),
      brightRed: color(role.contentPrimary, "red"),
      brightGreen: color(role.contentPrimary, "green"),
      brightYellow: color(role.contentPrimary, "yellow"),
      brightBlue: color(role.contentPrimary, "blue"),
      brightMagenta: color(role.contentPrimary, "pink"),
      brightCyan: color(role.contentPrimary, "teal"),
      brightWhite: white,
    } satisfies ITheme;

    return { theme, fontFamily, fontSize };
  } finally {
    probe.remove();
  }
}

/** Whether keys typed into `tab` reach a shell: one running, or one starting, which keeps them until it runs. */
function takesInput(tab: TerminalTab): boolean {
  return tab.kind === "shell" && (tab.state.kind === "running" || tab.state.kind === "starting");
}

/**
 * Ghostty's compatibility container is editable; only its input should accept
 * native text and IME. The fit addon defers a fit that lands while a previous
 * one settles, so the PTY follows the terminal's own resize event rather than
 * a read after fit().
 */
async function createView(id: string): Promise<TerminalView | undefined> {
  const engine = await loadGhostty();
  const existing = views.get(id);

  if (existing !== undefined) return existing;
  const initialTab = getTerminal(id);

  if (initialTab === undefined) return undefined;
  const commandOutput = initialTab.kind !== "shell";
  const root = document.documentElement;
  const initialAppearance = terminalAppearance();
  const element = document.createElement("div");
  element.style.width = "100%";
  element.style.height = "100%";
  element.style.overflow = "hidden";
  element.style.position = "relative";
  element.style.caretColor = "transparent";

  const terminal = new Terminal({
    ghostty: engine,
    cursorStyle: "bar",
    cursorBlink: preferences.terminalCursorBlink.get(),
    theme: initialAppearance.theme,
    colorScheme: root.dataset["displayMode"] === "dark" ? "dark" : "light",
    fontFamily: initialAppearance.fontFamily,
    fontSize: initialAppearance.fontSize,
    scrollback: preferences.terminalScrollback.get(),
    smoothScrollDuration: 0,
    convertEol: commandOutput,
    disableStdin: commandOutput || !takesInput(initialTab),
  });

  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(element);

  if (commandOutput) terminal.write("\u001b[?25l");
  element.removeAttribute("contenteditable");
  element.removeAttribute("role");
  element.removeAttribute("aria-label");
  element.removeAttribute("aria-multiline");
  element.tabIndex = -1;
  const focusInput = (): void => terminal.textarea?.focus({ preventScroll: true });
  element.addEventListener("focus", focusInput);
  terminal.textarea?.setAttribute(
    "aria-label",
    commandOutput ? "Command output" : "Terminal input",
  );

  if (commandOutput) terminal.textarea?.setAttribute("readonly", "");

  let mirrorFrame = 0;

  const mirrorOutput = (): void => {
    cancelAnimationFrame(mirrorFrame);
    mirrorFrame = requestAnimationFrame(() => {
      if (terminal.textarea !== undefined) terminal.textarea.value = terminalPrinted(id);
    });
  };

  if (commandOutput) mirrorOutput();

  terminal.textarea?.setAttribute("spellcheck", "false");
  let resizeFrame = 0;
  let lastSize = "";

  const syncSize = (): void => {
    const size = String(terminal.cols) + ":" + String(terminal.rows);
    const tab = getTerminal(id);

    if (
      size === lastSize ||
      tab === undefined ||
      tab.kind !== "shell" ||
      tab.state.kind !== "running"
    ) {
      return;
    }

    lastSize = size;
    void terminalActions
      .resize(
        id,
        Math.min(1000, Math.max(2, terminal.cols)),
        Math.min(1000, Math.max(1, terminal.rows)),
      )
      .catch((cause: unknown) => {
        toast.add({
          type: "error",
          title: "Couldn't resize terminal",
          id: "terminal-resize-" + id,
          description: errorMessage(cause),
        });
      });
  };

  const fitVisible = (): void => {
    if (!element.isConnected || element.clientWidth === 0 || element.clientHeight === 0) return;
    fit.fit();
    syncSize();
  };

  const sized = terminal.onResize(syncSize);

  const scheduleFit = (): void => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitVisible);
  };

  const update = (tab: TerminalTab): void => {
    terminal.options.disableStdin = !takesInput(tab);

    if (commandOutput) mirrorOutput();
    scheduleFit();
  };

  const resize = new ResizeObserver(scheduleFit);
  resize.observe(element);
  let lastAppearance = "";

  const appearance = new MutationObserver(() => {
    const next = terminalAppearance();
    const signature = JSON.stringify([root.dataset["displayMode"], next]);

    if (signature === lastAppearance) return;
    lastAppearance = signature;
    terminal.options.theme = next.theme;
    terminal.options.colorScheme = root.dataset["displayMode"] === "dark" ? "dark" : "light";
    terminal.options.fontFamily = next.fontFamily;
    terminal.options.fontSize = next.fontSize;
    scheduleFit();
  });

  appearance.observe(root, {
    attributes: true,
    attributeFilter: ["style", "class", "data-display-mode"],
  });

  const stopBlink = preferences.terminalCursorBlink.subscribe(() => {
    terminal.options.cursorBlink = preferences.terminalCursorBlink.get();
  });

  const stopScrollback = preferences.terminalScrollback.subscribe(() => {
    terminal.options.scrollback = preferences.terminalScrollback.get();
  });

  document.fonts.addEventListener("loadingdone", scheduleFit);
  const input = serial();
  const data = terminal.onData((value) => void input.run(() => terminalActions.write(id, value)));

  const title = terminal.onTitleChange((value) => terminalActions.title(id, value));

  const copy = (event: ClipboardEvent): void => {
    const text = terminal.getSelection();

    if (text === "") return;
    event.preventDefault();
    event.clipboardData?.setData("text/plain", text);
  };

  const paste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData("text/plain");

    if (text === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const tab = getTerminal(id);

    if (tab === undefined || tab.kind !== "shell" || tab.state.kind !== "running") return;
    terminal.paste(text);
  };

  element.addEventListener("copy", copy, true);
  element.addEventListener("paste", paste, true);
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.ctrlKey && event.code === "Backquote") return true;

    if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && event.key.toLowerCase() === "c") {
      if (event.type === "keydown") document.execCommand("copy");

      return true;
    }

    return false;
  });
  const view = { element, terminal, fit: fitVisible };
  views.set(id, view);
  attachTerminalOutput(id, {
    write(value) {
      terminal.write(commandOutput ? value + "\u001b[?25l" : value);

      if (commandOutput) mirrorOutput();
    },
    update,
    dispose() {
      cancelAnimationFrame(resizeFrame);
      cancelAnimationFrame(mirrorFrame);
      resize.disconnect();
      appearance.disconnect();
      stopBlink();
      stopScrollback();
      document.fonts.removeEventListener("loadingdone", scheduleFit);
      data.dispose();
      sized.dispose();
      title.dispose();
      element.removeEventListener("copy", copy, true);
      element.removeEventListener("paste", paste, true);
      element.removeEventListener("focus", focusInput);
      terminal.dispose();
      element.remove();
      views.delete(id);
    },
  });
  scheduleFit();

  return view;
}

/**
 * React owns the mount point; the terminal and scrollback live until the tab
 * closes. A hidden slot keeps its view out of the DOM, so no layout or resize
 * reaches the PTY until the slot shows again.
 */
export function mountTerminal(id: string, container: HTMLDivElement, visible: boolean): () => void {
  let detached = false;
  let element: HTMLDivElement | undefined;
  void createView(id)
    .then((view) => {
      if (detached || view === undefined || !visible) return;
      element = view.element;
      container.append(view.element);
      view.fit();

      if (container.checkVisibility()) view.terminal.textarea?.focus({ preventScroll: true });
    })
    .catch((cause: unknown) => terminalActions.fail(id, errorMessage(cause)));

  return () => {
    detached = true;
    element?.remove();
  };
}

export function focusTerminal(id: string): void {
  const view = views.get(id);

  if (view?.element.checkVisibility()) view.terminal.textarea?.focus({ preventScroll: true });
}

export function clearTerminal(id: string): void {
  views.get(id)?.terminal.clear();
}

export function copyTerminal(id: string): void {
  const selection = views.get(id)?.terminal.getSelection();

  if (selection)
    void navigator.clipboard.writeText(selection).catch((cause: unknown) =>
      toast.add({
        type: "error",
        title: "Couldn't copy selection",
        description: errorMessage(cause),
      }),
    );
}
