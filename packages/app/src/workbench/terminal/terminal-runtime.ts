import type { Cursor, Mark } from "@nyte-ai/vt";
import { serial } from "@nyte-ai/schema/serial";
import { toast } from "@nyte-ai/ui/toast";
import { props } from "@stylexjs/stylex";
import { addToChat } from "../../references/add-to-chat.ts";
import type { ExcerptReference } from "../../references/message-references.ts";
import { errorMessage } from "../../contract/errors.ts";
import { nyte } from "../../contract/nyte.ts";
import { openExternal } from "../../lib/open-external.ts";
import {
  attachTerminalOutput,
  getTerminal,
  terminalActions,
  terminalPrinted,
} from "./terminal-store.ts";
import type { TerminalTab } from "./terminal-store.ts";
import { loadGhostty } from "./ghostty.ts";
import { attachInput } from "./terminal-input.ts";
import { findLink } from "./terminal-links.ts";
import { attachPointer } from "./terminal-pointer.ts";
import { openTerminalSurface } from "./terminal-surface.ts";
import type { TerminalSurface } from "./terminal-surface.ts";
import { terminalStyles } from "./terminal.stylex.ts";

interface TerminalView {
  readonly element: HTMLDivElement;
  readonly surface: TerminalSurface;
  readonly marks: Mark[];
  attach(container: HTMLDivElement): void;
  detach(): void;
  focus(): void;
  clear(): void;
  redraw(): void;
}

const views = new Map<string, TerminalView>();

const pending = new Map<string, Promise<TerminalView | undefined>>();

const selectionListeners = new Map<string, Set<() => void>>();

const encoder = new TextEncoder();

const KEPT_MARKS = 200;

const MIRROR_MS = 250;

const RESIZE_SETTLE_MS = 100;

function notifySelection(id: string): void {
  for (const listener of selectionListeners.get(id) ?? []) listener();
}

function running(tab: TerminalTab | undefined): boolean {
  return tab !== undefined && tab.kind === "shell" && tab.state.kind === "running";
}

function createView(id: string): Promise<TerminalView | undefined> {
  const existing = views.get(id);

  if (existing !== undefined) return Promise.resolve(existing);
  const created = pending.get(id) ?? buildView(id).finally(() => pending.delete(id));
  pending.set(id, created);

  return created;
}

async function buildView(id: string): Promise<TerminalView | undefined> {
  const engine = await loadGhostty();
  const initialTab = getTerminal(id);

  if (initialTab === undefined) return undefined;
  const shell = initialTab.kind === "shell";
  const element = document.createElement("div");
  element.className = props(terminalStyles.screen).className ?? "";
  element.tabIndex = -1;
  const stage = document.createElement("div");
  stage.className = props(terminalStyles.stage).className ?? "";
  element.append(stage);
  const textarea = createTextarea(shell);
  const queue = serial();
  const marks: Mark[] = [];
  let attached = false;
  let focused = false;
  let mirrorTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSize = "";
  let inputAt = "";

  const send = (bytes: Uint8Array): void => {
    if (bytes.length === 0) return;
    void queue.run(() => terminalActions.write(id, bytes));
  };

  const sendToRunning = (bytes: Uint8Array): void => {
    if (running(getTerminal(id))) send(bytes);
  };

  const placeInput = (cursor: Cursor | null): void => {
    if (cursor === null) return;
    const size = surface.cell();
    const at = [cursor.x * size.width, cursor.y * size.height, size.height].join(":");

    if (at === inputAt) return;
    inputAt = at;
    textarea.style.left = `${String(cursor.x * size.width)}px`;
    textarea.style.top = `${String(cursor.y * size.height)}px`;
    textarea.style.height = `${String(size.height)}px`;
  };

  const syncSize = (): void => {
    const terminal = surface.terminal;
    const size = `${String(terminal.cols)}:${String(terminal.rows)}`;

    if (size === lastSize || !running(getTerminal(id))) return;
    lastSize = size;
    void terminalActions.resize(id, terminal.cols, terminal.rows).catch((cause: unknown) => {
      toast.add({
        type: "error",
        title: "Couldn't resize terminal",
        id: `terminal-resize-${id}`,
        description: errorMessage(cause),
      });
    });
  };

  const surface = await openTerminalSurface(engine, stage, {
    cursor: shell ? "shell" : "none",
    newlineMode: !shell,
    reply: sendToRunning,
    title: (title) => terminalActions.title(id, title),
    painted(cursor) {
      placeInput(cursor);
      scrollbar.render();
    },
    resized() {
      inputAt = "";
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(syncSize, RESIZE_SETTLE_MS);
    },
  });

  if (getTerminal(id) === undefined) {
    surface.dispose();

    return undefined;
  }

  const terminal = surface.terminal;
  stage.append(textarea);
  const scrollbar = mountScrollbar(surface, element);

  const mirrorNow = (): void => {
    clearTimeout(mirrorTimer);
    mirrorTimer = undefined;

    if (element.isConnected) textarea.value = terminalPrinted(id);
  };

  const mirror = (): void => {
    if (shell || mirrorTimer !== undefined || !element.isConnected) return;
    mirrorTimer = setTimeout(mirrorNow, MIRROR_MS);
  };

  const disposeMarks = (): void => {
    marks.splice(0).forEach((mark) => mark.dispose());
  };

  const markCommand = (): void => {
    const mark = terminal.markCursorLine();

    if (mark === null) return;
    marks.push(mark);

    if (marks.length > KEPT_MARKS) marks.shift()?.dispose();
  };

  const focusInput = (): void => textarea.focus({ preventScroll: true });

  const setFocused = (value: boolean): void => {
    if (focused === value) return;
    focused = value;
    sendToRunning(terminal.focus(value));
    surface.focus(value);
  };

  const acknowledge = (): void => terminalActions.acknowledge(id);

  const stopInput = attachInput({
    terminal,
    element,
    textarea,
    shell,
    takesInput() {
      const tab = getTerminal(id);

      return (
        tab !== undefined &&
        tab.kind === "shell" &&
        (tab.state.kind === "running" || tab.state.kind === "starting")
      );
    },
    send,
    typed() {
      const bar = terminal.scrollbar();

      if (bar.offset + bar.length < bar.total) {
        terminal.scrollToBottom();
        surface.draw(true);
      }

      surface.restartBlink();
    },
    submitted: markCommand,
    focused: setFocused,
    copy: () => copyTerminal(id),
    addToChat: () => addTerminalToChat(id),
  });

  const stopPointer = attachPointer({
    terminal,
    canvas: surface.canvas,
    cell: () => surface.cell(),
    tracking: () => running(getTerminal(id)) && terminal.mouseTracking(),
    send: sendToRunning,
    focus: focusInput,
    selecting: () => surface.draw(true),
    settled: () => setTimeout(() => notifySelection(id)),
    scrolled: () => surface.draw(true),
    linkModifier: (event) => (nyte.platform === "darwin" ? event.metaKey : event.ctrlKey),
    link: (at) =>
      findLink(
        at,
        (y) => surface.row(y),
        (cell) => terminal.hyperlink(cell.column, cell.row),
      ),
    showLink: (link) => surface.showLink(link),
    openLink: (url) => openExternal(url),
  });

  element.addEventListener("focus", focusInput);
  element.addEventListener("keydown", acknowledge, true);

  const view: TerminalView = {
    element,
    surface,
    marks,
    attach(container) {
      container.append(element);
      attached = true;
      surface.show();
      mirrorNow();
    },
    detach() {
      setFocused(false);
      attached = false;
      element.remove();
      surface.hide();
    },
    focus: focusInput,
    redraw: () => surface.draw(true),
    clear() {
      terminal.write(encoder.encode("\u001b[H\u001b[2J\u001b[3J"));
      terminal.clearSelection();
      disposeMarks();
      notifySelection(id);
      surface.draw(true);
    },
  };

  views.set(id, view);
  attachTerminalOutput(id, {
    reset() {
      terminal.reset();
      terminal.clearSelection();
      disposeMarks();
      notifySelection(id);
      mirror();
      surface.draw(true);
    },
    write(data) {
      terminal.write(data);
      mirror();
      surface.draw(false);
    },
    update() {
      mirror();
      surface.fit();
      syncSize();
    },
    visible: () => attached && element.checkVisibility(),
    dispose() {
      clearTimeout(mirrorTimer);
      clearTimeout(resizeTimer);
      element.removeEventListener("focus", focusInput);
      element.removeEventListener("keydown", acknowledge, true);
      stopInput();
      stopPointer();
      disposeMarks();
      scrollbar.dispose();
      attached = false;
      surface.dispose();
      element.remove();
      views.delete(id);
    },
  });

  return view;
}

function createTextarea(shell: boolean): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  textarea.setAttribute("aria-label", shell ? "Terminal input" : "Command output");
  textarea.setAttribute("spellcheck", "false");
  textarea.setAttribute("autocapitalize", "off");
  textarea.setAttribute("autocomplete", "off");
  textarea.setAttribute("autocorrect", "off");

  if (!shell) textarea.readOnly = true;
  textarea.className = props(terminalStyles.input).className ?? "";
  textarea.style.left = "0";
  textarea.style.top = "0";

  return textarea;
}

function mountScrollbar(surface: TerminalSurface, element: HTMLElement) {
  const terminal = surface.terminal;
  const bar = document.createElement("div");
  const thumb = document.createElement("div");
  bar.setAttribute("aria-hidden", "true");
  thumb.className = props(terminalStyles.thumb).className ?? "";
  bar.append(thumb);
  element.append(bar);
  let drag: { readonly y: number; readonly offset: number } | undefined;

  const render = (): void => {
    const state = terminal.scrollbar();
    const scrollback = state.total - state.length;

    bar.className =
      props(
        terminalStyles.scrollbar,
        drag !== undefined && terminalStyles.scrollbarHeld,
        scrollback <= 0 && terminalStyles.scrollbarEmpty,
      ).className ?? "";

    if (scrollback <= 0) return;
    const size = Math.max(24, (state.length / state.total) * bar.clientHeight);
    const offset = ((bar.clientHeight - size) * state.offset) / scrollback;
    thumb.style.height = `${String(size)}px`;
    thumb.style.transform = `translateY(${String(offset)}px)`;
  };

  const scrollTo = (offset: number): void => {
    terminal.scroll(Math.round(offset) - terminal.scrollbar().offset);
    surface.draw(true);
  };

  const scrollback = (): number => {
    const state = terminal.scrollbar();

    return state.total - state.length;
  };

  const press = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    const travel = bar.clientHeight - thumb.offsetHeight;

    if (event.target !== thumb && travel > 0) {
      const top = event.clientY - bar.getBoundingClientRect().top - thumb.offsetHeight / 2;
      scrollTo((top / travel) * scrollback());
    }

    drag = { y: event.clientY, offset: terminal.scrollbar().offset };
    bar.setPointerCapture(event.pointerId);
    render();
  };

  const move = (event: PointerEvent): void => {
    const travel = bar.clientHeight - thumb.offsetHeight;

    if (drag === undefined || travel <= 0) return;
    scrollTo(drag.offset + ((event.clientY - drag.y) / travel) * scrollback());
  };

  const release = (): void => {
    drag = undefined;
    render();
  };

  bar.addEventListener("pointerdown", press);
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", release);
  bar.addEventListener("pointercancel", release);

  return {
    render,
    dispose() {
      bar.removeEventListener("pointerdown", press);
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", release);
      bar.removeEventListener("pointercancel", release);
      bar.remove();
    },
  };
}

export function mountTerminal(id: string, container: HTMLDivElement, visible: boolean): () => void {
  let detached = false;
  let mounted: TerminalView | undefined;
  void createView(id)
    .then((view) => {
      if (detached || view === undefined || !visible) return;
      mounted = view;
      view.attach(container);

      if (container.checkVisibility()) view.focus();
    })
    .catch((cause: unknown) => terminalActions.fail(id, errorMessage(cause)));

  return () => {
    detached = true;
    mounted?.detach();
  };
}

export function focusTerminal(id: string): void {
  const view = views.get(id);

  if (view?.element.checkVisibility()) view.focus();
}

export function clearTerminal(id: string): void {
  views.get(id)?.clear();
}

export function copyTerminal(id: string): void {
  const selection = views.get(id)?.surface.terminal.selectionText();

  if (selection)
    void navigator.clipboard.writeText(selection).catch((cause: unknown) =>
      toast.add({
        type: "error",
        title: "Couldn't copy selection",
        description: errorMessage(cause),
      }),
    );
}

function terminalExcerpt(id: string): ExcerptReference | undefined {
  const view = views.get(id);
  const tab = getTerminal(id);
  const text = view?.surface.terminal.selectionText().replace(/\s+$/u, "") ?? "";

  if (view === undefined || tab === undefined || text === "") return undefined;
  const top = view.surface.terminal.selectionTop();

  const command =
    tab.kind === "job"
      ? tab.title
      : view.marks
          .findLast((mark) => {
            const row = mark.row();

            return row !== null && top !== null && row <= top;
          })
          ?.text.trim();

  return {
    kind: "excerpt",
    source: command === undefined ? { kind: "terminal" } : { kind: "terminal", command },
    text,
  };
}

export function terminalHasSelection(id: string): boolean {
  return views.get(id)?.surface.terminal.hasSelection() === true;
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
  const view = views.get(id);
  view?.surface.terminal.clearSelection();
  view?.redraw();
  notifySelection(id);

  return true;
}
