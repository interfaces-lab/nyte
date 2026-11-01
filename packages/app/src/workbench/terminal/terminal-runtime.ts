import { FitAddon, Terminal } from "ghostty-web";
import type { Ghostty, ITerminalOptions, ITheme } from "ghostty-web";
import { serial } from "@nyte-ai/schema/serial";
import { toast } from "@nyte-ai/ui/toast";
import { preferences } from "../../preferences/index.ts";
import { addToChat, addsToChat } from "../../references/add-to-chat.ts";
import type { ExcerptReference } from "../../references/message-references.ts";
import { errorMessage } from "../../contract/errors.ts";
import { nyte } from "../../contract/nyte.ts";
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
import { loadGhostty } from "./ghostty.ts";

interface CommandMark {
  readonly row: number;
  readonly line: string;
}

interface TerminalView {
  readonly element: HTMLDivElement;
  readonly terminal: Terminal;
  readonly commands: CommandMark[];
  fit(): void;
  show(): void;
  hide(): void;
  wake(): void;
}

const views = new Map<string, TerminalView>();

const selectionListeners = new Map<string, Set<() => void>>();

function notifySelection(id: string): void {
  for (const listener of selectionListeners.get(id) ?? []) listener();
}

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

type ThemedTerminalOptions = Omit<
  ITerminalOptions,
  "ghostty" | "theme" | "colorScheme" | "fontFamily" | "fontSize" | "cursorStyle" | "cursorBlink"
>;

export interface ThemedTerminal {
  readonly terminal: Terminal;
  readonly fit: FitAddon;
  /** Stops following the appearance and cursor preferences and disposes the terminal. */
  dispose(): void;
}

/**
 * Opens a ghostty terminal in `element` in the app's theme, code font and cursor preferences, and
 * keeps them current. `onRestyle` runs after the theme or font changes.
 */
export function openThemedTerminal(
  engine: Ghostty,
  element: HTMLElement,
  options: ThemedTerminalOptions,
  onRestyle: () => void,
): ThemedTerminal {
  const root = document.documentElement;
  const appearance = terminalAppearance();

  const terminal = new Terminal({
    ...options,
    ghostty: engine,
    cursorStyle: preferences.terminalCursorStyle.get(),
    cursorBlink: preferences.terminalCursorBlink.get(),
    theme: appearance.theme,
    colorScheme: root.dataset["displayMode"] === "dark" ? "dark" : "light",
    fontFamily: appearance.fontFamily,
    fontSize: appearance.fontSize,
  });

  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(element);
  let lastAppearance = "";

  const restyle = new MutationObserver(() => {
    const next = terminalAppearance();
    const signature = JSON.stringify([root.dataset["displayMode"], next]);

    if (signature === lastAppearance) return;
    lastAppearance = signature;
    terminal.options.theme = next.theme;
    terminal.options.colorScheme = root.dataset["displayMode"] === "dark" ? "dark" : "light";
    terminal.options.fontFamily = next.fontFamily;
    terminal.options.fontSize = next.fontSize;
    onRestyle();
  });

  restyle.observe(root, {
    attributes: true,
    attributeFilter: ["style", "class", "data-display-mode"],
  });

  const stopCursorStyle = preferences.terminalCursorStyle.subscribe(() => {
    terminal.options.cursorStyle = preferences.terminalCursorStyle.get();
  });

  const stopBlink = preferences.terminalCursorBlink.subscribe(() => {
    terminal.options.cursorBlink = preferences.terminalCursorBlink.get();
  });

  return {
    terminal,
    fit,
    dispose() {
      restyle.disconnect();
      stopCursorStyle();
      stopBlink();
      terminal.dispose();
    },
  };
}

function takesInput(tab: TerminalTab): boolean {
  return tab.kind === "shell" && (tab.state.kind === "running" || tab.state.kind === "starting");
}

async function createView(id: string): Promise<TerminalView | undefined> {
  const engine = await loadGhostty();
  const existing = views.get(id);

  if (existing !== undefined) return existing;
  const initialTab = getTerminal(id);

  if (initialTab === undefined) return undefined;
  const commandOutput = initialTab.kind !== "shell";
  const element = document.createElement("div");
  element.style.width = "100%";
  element.style.height = "100%";
  element.style.overflow = "hidden";
  element.style.position = "relative";
  element.style.caretColor = "transparent";

  const themed = openThemedTerminal(
    engine,
    element,
    {
      scrollback: preferences.terminalScrollback.get(),
      smoothScrollDuration: 0,
      convertEol: commandOutput,
      disableStdin: commandOutput || !takesInput(initialTab),
    },
    () => scheduleFit(),
  );

  const terminal = themed.terminal;
  const fit = themed.fit;
  terminal.pauseRendering();

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

  let mirrorTimer: ReturnType<typeof setTimeout> | undefined;

  const mirrorNow = (): void => {
    clearTimeout(mirrorTimer);
    mirrorTimer = undefined;

    if (!element.isConnected || terminal.textarea === undefined) return;
    terminal.textarea.value = terminalPrinted(id);
  };

  const mirrorOutput = (): void => {
    if (mirrorTimer !== undefined || !element.isConnected) return;
    mirrorTimer = setTimeout(mirrorNow, 250);
  };

  let shown = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const rest = (): void => {
    if (document.hasFocus() && element.contains(document.activeElement)) return;
    terminal.pauseRendering();
  };

  const wake = (): void => {
    if (!shown) return;
    terminal.resumeRendering();
    clearTimeout(idleTimer);
    idleTimer = setTimeout(rest, 1000);
  };

  const wakeEvents = ["focusin", "focusout", "wheel", "pointerdown", "pointermove", "keydown"];

  for (const name of wakeEvents)
    element.addEventListener(name, wake, { capture: true, passive: true });
  window.addEventListener("focus", wake);
  window.addEventListener("blur", wake);

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
    wake();
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

  const stopScrollback = preferences.terminalScrollback.subscribe(() => {
    terminal.options.scrollback = preferences.terminalScrollback.get();
  });

  document.fonts.addEventListener("loadingdone", scheduleFit);
  const input = serial();
  const commands: CommandMark[] = [];

  const data = terminal.onData((value) => {
    if (value.includes("\r")) markCommand(terminal, commands);
    void input.run(() => terminalActions.write(id, value));
  });

  const title = terminal.onTitleChange((value) => terminalActions.title(id, value));

  const selected = terminal.onSelectionChange(() => {
    wake();
    notifySelection(id);
  });

  const reportSettledSelection = (): void => {
    setTimeout(() => notifySelection(id));
  };

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

  element.addEventListener("mousedown", reportSettledSelection);
  element.ownerDocument.addEventListener("mouseup", reportSettledSelection);
  element.addEventListener("copy", copy, true);
  element.addEventListener("paste", paste, true);
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.ctrlKey && event.code === "Backquote") return true;

    if (addsToChat(event, nyte.platform === "darwin")) {
      if (event.type === "keydown" && addTerminalToChat(id)) event.preventDefault();

      return true;
    }

    if ((event.metaKey || (event.ctrlKey && event.shiftKey)) && event.key.toLowerCase() === "c") {
      if (event.type === "keydown") document.execCommand("copy");

      return true;
    }

    return false;
  });

  const view = {
    element,
    terminal,
    commands,
    fit: fitVisible,
    show() {
      shown = true;
      wake();

      if (commandOutput) mirrorNow();
    },
    hide() {
      shown = false;
      clearTimeout(idleTimer);
      terminal.pauseRendering();
    },
    wake,
  };

  views.set(id, view);
  attachTerminalOutput(id, {
    reset() {
      terminal.clearSelection();
      terminal.write("\u001bc\u001b[?25l");
      wake();
      mirrorOutput();
    },
    write(value) {
      terminal.write(commandOutput ? value + "\u001b[?25l" : value);
      wake();

      if (commandOutput) mirrorOutput();
    },
    update,
    visible: () => element.checkVisibility(),
    dispose() {
      cancelAnimationFrame(resizeFrame);
      clearTimeout(mirrorTimer);
      clearTimeout(idleTimer);

      for (const name of wakeEvents) element.removeEventListener(name, wake, true);
      window.removeEventListener("focus", wake);
      window.removeEventListener("blur", wake);
      resize.disconnect();
      stopScrollback();
      document.fonts.removeEventListener("loadingdone", scheduleFit);
      data.dispose();
      sized.dispose();
      title.dispose();
      selected.dispose();
      element.removeEventListener("mousedown", reportSettledSelection);
      element.ownerDocument.removeEventListener("mouseup", reportSettledSelection);
      element.removeEventListener("copy", copy, true);
      element.removeEventListener("paste", paste, true);
      element.removeEventListener("focus", focusInput);
      themed.dispose();
      element.remove();
      views.delete(id);
    },
  });
  scheduleFit();

  return view;
}

export function mountTerminal(id: string, container: HTMLDivElement, visible: boolean): () => void {
  let detached = false;
  let mounted: TerminalView | undefined;
  void createView(id)
    .then((view) => {
      if (detached || view === undefined || !visible) return;
      mounted = view;
      container.append(view.element);
      view.show();
      view.fit();

      if (container.checkVisibility()) view.terminal.textarea?.focus({ preventScroll: true });
    })
    .catch((cause: unknown) => terminalActions.fail(id, errorMessage(cause)));

  return () => {
    detached = true;

    if (mounted === undefined) return;
    mounted.element.remove();
    mounted.hide();
  };
}

export function focusTerminal(id: string): void {
  const view = views.get(id);

  if (view?.element.checkVisibility()) view.terminal.textarea?.focus({ preventScroll: true });
}

export function clearTerminal(id: string): void {
  const view = views.get(id);
  view?.terminal.clear();
  view?.wake();
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

function bufferLine(terminal: Terminal, row: number): string | undefined {
  return terminal.buffer.active.getLine(row)?.translateToString(true).trim();
}

function markCommand(terminal: Terminal, commands: CommandMark[]): void {
  const buffer = terminal.buffer.active;

  if (buffer.type !== "normal") return;
  const row = buffer.length - terminal.rows + buffer.cursorY;
  const line = bufferLine(terminal, row);

  if (line === undefined || line === "") return;
  commands.push({ row, line });

  if (commands.length > 200) commands.shift();
}

function terminalExcerpt(id: string): ExcerptReference | undefined {
  const view = views.get(id);
  const tab = getTerminal(id);
  const text = view?.terminal.getSelection().replace(/\s+$/u, "") ?? "";

  if (view === undefined || tab === undefined || text === "") return undefined;
  const top = view.terminal.getSelectionPosition()?.start.y ?? -1;

  const command =
    tab.kind === "job"
      ? tab.title
      : view.commands.findLast(
          (mark) => mark.row <= top && bufferLine(view.terminal, mark.row) === mark.line,
        )?.line;

  return {
    kind: "excerpt",
    source: command === undefined ? { kind: "terminal" } : { kind: "terminal", command },
    text,
  };
}

export function terminalHasSelection(id: string): boolean {
  return views.get(id)?.terminal.hasSelection() === true;
}

export function subscribeTerminalSelection(id: string, listener: () => void): () => void {
  const listeners = selectionListeners.get(id) ?? new Set();
  listeners.add(listener);
  selectionListeners.set(id, listeners);

  return () => {
    listeners.delete(listener);

    if (listeners.size === 0) selectionListeners.delete(id);
  };
}

export function addTerminalToChat(id: string): boolean {
  const reference = terminalExcerpt(id);

  if (reference === undefined || !addToChat({ reference })) return false;
  views.get(id)?.terminal.clearSelection();
  notifySelection(id);

  return true;
}
