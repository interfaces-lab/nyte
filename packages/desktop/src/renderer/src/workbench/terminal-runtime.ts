import { FitAddon, Ghostty, Terminal } from "ghostty-web";
import type { ITheme } from "ghostty-web";
import wasmUrl from "ghostty-web/ghostty-vt.wasm?url";
import { toast } from "@nyte-ai/ui/sonner";
import { nyte } from "../nyte.ts";
import { errorMessage } from "../../../shared/errors.ts";
import {
  attachTerminalOutput,
  getTerminal,
  isShellTerminal,
  terminalActions,
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
function terminalTheme(): ITheme {
  const probe = document.createElement("span");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("Canvas rendering is unavailable");
  document.documentElement.append(probe);

  const background = getComputedStyle(document.documentElement).getPropertyValue(
    "--nyte-bg-chrome",
  );

  const color = (variable: string): string => {
    probe.style.color = "var(" + variable + ")";
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = background;
    context.fillRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(probe).color;
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
    return {
      background: color("--nyte-bg-chrome"),
      foreground: color("--nyte-text-primary"),
      cursor: color("--nyte-text-primary"),
      selectionBackground: color("--nyte-bg-secondary"),
      black: "#141414",
      red: color("--nyte-text-danger"),
      green: color("--nyte-text-success"),
      yellow: color("--nyte-text-warning"),
      blue: color("--nyte-text-accent"),
      magenta: color("--nyte-purple"),
      cyan: color("--nyte-text-cyan-primary"),
      white: "#eeeeee",
      brightBlack: color("--nyte-text-tertiary"),
      brightRed: color("--nyte-red"),
      brightGreen: color("--nyte-green"),
      brightYellow: color("--nyte-yellow"),
      brightBlue: color("--nyte-accent"),
      brightMagenta: color("--nyte-magenta"),
      brightCyan: color("--nyte-cyan"),
      brightWhite: "#ffffff",
    };
  } finally {
    probe.remove();
  }
}

function sendInput(id: string, data: string): Promise<void> {
  const tab = getTerminal(id);

  if (tab === undefined || !isShellTerminal(tab) || tab.state.kind !== "running") {
    return Promise.resolve();
  }

  const write = async (): Promise<void> => {
    for (let start = 0; start < data.length;) {
      let end = Math.min(start + 65536, data.length);
      const last = data.charCodeAt(end - 1);

      if (end < data.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
      await nyte.host.terminal.write({ id, data: data.slice(start, end) });
      start = end;
    }
  };

  return write().catch((cause: unknown) => {
    const current = getTerminal(id);

    if (current !== undefined && isShellTerminal(current) && current.state.kind === "running") {
      toast.error("Couldn't write to terminal", {
        id: "terminal-write-" + id,
        description: errorMessage(cause),
      });
    }
  });
}

async function createView(id: string): Promise<TerminalView | undefined> {
  const engine = await loadGhostty();
  const existing = views.get(id);

  if (existing !== undefined) return existing;
  const initialTab = getTerminal(id);

  if (initialTab === undefined) return undefined;
  const commandOutput = !isShellTerminal(initialTab);
  const root = document.documentElement;
  const css = getComputedStyle(root);
  const element = document.createElement("div");
  element.style.width = "100%";
  element.style.height = "100%";
  element.style.overflow = "hidden";
  element.style.position = "relative";
  element.style.caretColor = "transparent";

  const terminal = new Terminal({
    ghostty: engine,
    cursorStyle: "bar",
    cursorBlink: false,
    theme: terminalTheme(),
    colorScheme: root.dataset["theme"] === "dark" ? "dark" : "light",
    fontFamily: css.getPropertyValue("--nyte-font-family-mono"),
    fontSize: Number.parseFloat(css.getPropertyValue("--nyte-font-size-code")),
    scrollback: 10000,
    smoothScrollDuration: 0,
    convertEol: commandOutput,
    disableStdin: commandOutput || initialTab.state.kind !== "running",
  });

  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(element);

  if (commandOutput) terminal.write("\u001b[?25l");
  // Ghostty's compatibility container is editable; only its input should accept native text/IME.
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

  if (!isShellTerminal(initialTab) && terminal.textarea !== undefined) {
    terminal.textarea.value = initialTab.source.output;
  }

  terminal.textarea?.setAttribute("spellcheck", "false");
  let disposed = false;
  let resizeFrame = 0;
  let lastSize = "";

  const fitVisible = (): void => {
    if (!element.isConnected || element.clientWidth === 0 || element.clientHeight === 0) return;
    fit.fit();
    const size = String(terminal.cols) + ":" + String(terminal.rows);
    const tab = getTerminal(id);

    if (
      size === lastSize ||
      tab === undefined ||
      !isShellTerminal(tab) ||
      tab.state.kind !== "running"
    ) {
      return;
    }

    lastSize = size;
    void nyte.host.terminal
      .resize({
        id,
        cols: Math.min(1000, Math.max(2, terminal.cols)),
        rows: Math.min(1000, Math.max(1, terminal.rows)),
      })
      .catch((cause: unknown) => {
        toast.error("Couldn't resize terminal", {
          id: "terminal-resize-" + id,
          description: errorMessage(cause),
        });
      });
  };

  const scheduleFit = (): void => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitVisible);
  };

  const update = (tab: TerminalTab): void => {
    terminal.options.disableStdin = !isShellTerminal(tab) || tab.state.kind !== "running";

    if (!isShellTerminal(tab) && terminal.textarea !== undefined) {
      terminal.textarea.value = tab.source.output;
    }

    scheduleFit();
  };

  const resize = new ResizeObserver(scheduleFit);
  resize.observe(element);
  let lastAppearance = "";

  const appearance = new MutationObserver(() => {
    const next = getComputedStyle(root);

    const signature = [
      root.dataset["theme"],
      root.style.getPropertyValue("--nyte-tint-hue"),
      root.style.getPropertyValue("--nyte-tint-intensity"),
      next.getPropertyValue("--nyte-font-family-mono"),
      next.getPropertyValue("--nyte-font-size-code"),
    ].join("|");

    if (signature === lastAppearance) return;
    lastAppearance = signature;
    terminal.options.theme = terminalTheme();
    terminal.options.colorScheme = root.dataset["theme"] === "dark" ? "dark" : "light";
    terminal.options.fontFamily = next.getPropertyValue("--nyte-font-family-mono");
    terminal.options.fontSize = Number.parseFloat(next.getPropertyValue("--nyte-font-size-code"));
    scheduleFit();
  });

  appearance.observe(root, { attributes: true, attributeFilter: ["style", "data-theme"] });
  document.fonts.addEventListener("loadingdone", scheduleFit);
  let pendingInput = Promise.resolve();

  const data = terminal.onData((value) => {
    pendingInput = pendingInput.then(() => sendInput(id, value));
  });

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

    if (tab === undefined || !isShellTerminal(tab) || tab.state.kind !== "running") return;
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
      terminal.write(commandOutput ? value + "\u001b[?25l" : value, () => {
        const tab = getTerminal(id);

        if (!disposed && tab !== undefined && isShellTerminal(tab)) {
          void nyte.host.terminal.acknowledge({ id, length: value.length }).catch(() => undefined);
        }
      });
    },
    replace(value) {
      // Clear through VT sequences: Ghostty.reset replaces WASM still held by its selection manager.
      terminal.clearSelection();
      terminal.scrollToBottom();
      terminal.write("\u001b[3J\u001b[2J\u001b[H" + value + "\u001b[?25l");
    },
    update,
    dispose() {
      disposed = true;
      cancelAnimationFrame(resizeFrame);
      resize.disconnect();
      appearance.disconnect();
      document.fonts.removeEventListener("loadingdone", scheduleFit);
      data.dispose();
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
    void navigator.clipboard
      .writeText(selection)
      .catch((cause: unknown) =>
        toast.error("Couldn't copy selection", { description: errorMessage(cause) }),
      );
}
