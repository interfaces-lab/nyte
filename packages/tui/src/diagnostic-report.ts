import {
  BoxRenderable,
  CliRenderEvents,
  MacOSScrollAccel,
  RenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { commandBindings, formatCommandBindings } from "@opentui/keymap/extras";
import { CHAT_KEYBINDS } from "./constants.ts";
import { closePanel, openPanel } from "./app/ui.ts";
import type { EphemeralPanel, Shell } from "./app/ui.ts";
import { displayWidth } from "./width.ts";

/** Explicit diagnostics keep their own viewport and never edit the composer. */
export class DiagnosticReport implements EphemeralPanel {
  readonly container: BoxRenderable;
  readonly rows = 0;
  readonly hints = "";
  private readonly text: TextRenderable;

  constructor(shell: Shell, title: string, lines: readonly string[], close: () => void) {
    this.container = new BoxRenderable(shell.renderer, {
      id: shell.nextId("report"),
      position: "absolute",
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      zIndex: 1,
      flexDirection: "column",
      backgroundColor: shell.theme.background,
      focusable: true,
      paddingX: 1,
    });
    const heading = new TextRenderable(shell.renderer, {
      content: title,
      fg: shell.theme.foreground,
      height: 1,
      flexShrink: 0,
      selectable: false,
    });
    const controls = new TextRenderable(shell.renderer, {
      // Keep the body stationary when selection takes over both primary controls.
      height: 2,
      fg: shell.theme.dim,
      flexShrink: 0,
      wrapMode: "word",
      selectable: false,
    });
    const navigation = new TextRenderable(shell.renderer, {
      fg: shell.theme.dim,
      flexShrink: 0,
      wrapMode: "word",
      selectable: false,
    });
    const scroll = new ScrollBoxRenderable(shell.renderer, {
      flexGrow: 1,
      minHeight: 1,
      scrollX: false,
      scrollY: true,
      stickyScroll: false,
      scrollAcceleration: new MacOSScrollAccel(),
      verticalScrollbarOptions: {
        trackOptions: {
          backgroundColor: shell.theme.scrollbarTrack,
          foregroundColor: shell.theme.scrollbarThumb,
        },
      },
    });
    this.text = new TextRenderable(shell.renderer, {
      content: lines.join("\n"),
      fg: shell.theme.foreground,
      flexShrink: 0,
      wrapMode: "word",
      selectable: true,
      selectionBg: shell.theme.selectionBackground,
      selectionFg: shell.theme.selectionForeground,
    });
    const position = new TextRenderable(shell.renderer, {
      fg: shell.theme.dim,
      height: 1,
      flexShrink: 0,
      selectable: false,
    });
    scroll.add(this.text);
    this.container.add(heading);
    this.container.add(controls);
    this.container.add(navigation);
    this.container.add(scroll);
    this.container.add(position);
    const actions = [
      {
        name: "report.close",
        title: "close",
        enabled: () => !shell.renderer.hasSelection,
        run: () => {
          // Selection can clear itself during dispatch. It must consume that key before close.
          if (shell.renderer.hasSelection) return false;
          close();
          return true;
        },
      },
      { name: "report.up", title: "up", run: () => scroll.scrollBy(-1) },
      { name: "report.down", title: "down", run: () => scroll.scrollBy(1) },
      { name: "report.page.up", title: "page up", run: () => scroll.scrollBy(-1, "viewport") },
      { name: "report.page.down", title: "page down", run: () => scroll.scrollBy(1, "viewport") },
      { name: "report.top", title: "top", run: () => scroll.scrollTo(0) },
      { name: "report.end", title: "end", run: () => scroll.scrollTo(scroll.scrollHeight) },
    ];
    const unregister = shell.keymap.registerLayer({
      priority: 20,
      enabled: () => !this.container.isDestroyed,
      commands: actions.map((action) => ({ ...action, namespace: "report" })),
      bindings: commandBindings({
        "report.close": `${CHAT_KEYBINDS["chat.interrupt"]},${CHAT_KEYBINDS["selection.copy"]}`,
        "report.up": CHAT_KEYBINDS["chat.history.previous"],
        "report.down": CHAT_KEYBINDS["chat.history.next"],
        "report.page.up": CHAT_KEYBINDS["chat.scroll.page.up"],
        "report.page.down": CHAT_KEYBINDS["chat.scroll.page.down"],
        "report.top": CHAT_KEYBINDS["chat.message.previous"],
        "report.end": CHAT_KEYBINDS["chat.message.next"],
      }),
    });
    let lastControls = "";
    let lastNavigation = "";
    let lastPosition = "";
    const paintControls = (): void => {
      if (this.container.isDestroyed) return;
      const entries = shell.keymap.getCommandEntries({
        namespace: ["report", "selection"],
        visibility: "active",
      });
      const primary = entries.filter(
        ({ command }) => command.name === "report.close" || command.namespace === "selection",
      );
      const secondary = entries.filter(
        ({ command }) => command.name !== "report.close" && command.namespace !== "selection",
      );
      const nextControls = reportControlRows(primary, shell.renderer.width - 2);
      if (nextControls !== lastControls) controls.content = lastControls = nextControls;
      const nextNavigation = reportControlRows(secondary, shell.renderer.width - 2);
      if (nextNavigation !== lastNavigation) {
        navigation.content = lastNavigation = nextNavigation;
      }
    };
    const paint = async (): Promise<void> => {
      if (this.container.isDestroyed) return;
      // Native scrolling and wrapping settle during layout, including mouse scrolling.
      this.text.width = Math.max(1, scroll.viewport.width);
      const total = scroll.scrollHeight;
      const end = Math.min(total, scroll.scrollTop + scroll.viewport.height);
      const nextPosition = `${String(scroll.scrollTop + 1)}-${String(end)}/${String(total)}${end < total ? " · more below" : " · end"}`;
      if (nextPosition !== lastPosition) position.content = lastPosition = nextPosition;
    };
    paintControls();
    const unsubscribe = shell.keymap.on("state", paintControls);
    shell.renderer.on(CliRenderEvents.SELECTION, paintControls);
    shell.renderer.on(CliRenderEvents.RESIZE, paintControls);
    shell.renderer.setFrameCallback(paint);
    this.container.once(RenderableEvents.DESTROYED, () => {
      unsubscribe();
      shell.renderer.off(CliRenderEvents.SELECTION, paintControls);
      shell.renderer.off(CliRenderEvents.RESIZE, paintControls);
      unregister();
      shell.renderer.removeFrameCallback(paint);
    });
  }

  update(lines: readonly string[]): void {
    if (!this.container.isDestroyed) this.text.content = lines.join("\n");
  }

  focus(): void {
    this.container.focus();
  }

  blur(): void {
    this.container.blur();
  }

  destroy(): void {
    this.container.parent?.remove(this.container);
    this.container.destroyRecursively();
  }
}

function reportControlRows(
  entries: ReturnType<Shell["keymap"]["getCommandEntries"]>,
  width: number,
): string {
  const rows: string[] = [];
  for (const { command, bindings } of entries) {
    // One installed binding per action keeps aliases from displacing the report body.
    const key = formatCommandBindings(bindings.slice(0, 1), {
      keyNameAliases: { escape: "esc" },
    });
    if (key === undefined) continue;
    const label = `${key} ${String(command.hint ?? command.title)}`;
    const previous = rows.at(-1);
    if (previous !== undefined && displayWidth(`${previous} · ${label}`) <= width)
      rows[rows.length - 1] = `${previous} · ${label}`;
    else rows.push(label);
  }
  return rows.join("\n");
}

export function openDiagnosticReport(
  shell: Shell,
  title: string,
  lines: readonly string[],
  onClose: () => void,
): DiagnosticReport | undefined {
  if (shell.root.isDestroyed || shell.ui.prompting || shell.ui.selecting) return undefined;
  const focus = shell.renderer.currentFocusedRenderable;
  const close = (): void => {
    if (shell.dismissInfoPanel !== close) return;
    shell.dismissInfoPanel = undefined;
    shell.setUi("overlay", undefined);
    closePanel(shell, panel);
    if (focus !== null && !focus.isDestroyed) shell.focus.use(focus);
    else shell.input.blur();
    onClose();
  };
  const panel = openPanel(shell, new DiagnosticReport(shell, title, lines, close));
  shell.setUi("overlay", panel.container);
  shell.dismissInfoPanel = close;
  return panel;
}
