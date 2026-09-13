import {
  bold,
  BoxRenderable,
  CliRenderEvents,
  fg,
  RenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import { GLYPHS, keycap } from "./constants.ts";
import { registerChatLayer } from "./keymap.ts";
import type { EphemeralPanel, Shell } from "./app/ui.ts";
import type { CliTheme } from "./theme.ts";
import type { UsageCard, UsageCardRow } from "./usage.ts";
import { displayWidth, padDisplay } from "./width.ts";

const BAR_CELLS = 20;

type UsagePanelState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly card: UsageCard }
  | { readonly kind: "failed"; readonly message: string };

/** A read-only report. The shell owns focus; the native scroll box owns scrolling and selection. */
export class UsagePanel implements EphemeralPanel {
  readonly container: BoxRenderable;
  private readonly renderer: CliRenderer;
  private readonly onRows: (rows: number) => void;
  readonly hints = `${keycap("chat.interrupt")} close · ${keycap("chat.history.previous")}/${keycap("chat.history.next")} scroll · ${keycap("chat.scroll.page.up")}/${keycap("chat.scroll.page.down")} page`;
  private readonly scroll: ScrollBoxRenderable;
  private readonly text: TextRenderable;
  private readonly theme: CliTheme;
  private state: UsagePanelState = { kind: "loading" };

  constructor(
    shell: Pick<Shell, "renderer" | "keymap" | "theme" | "nextId" | "newScrollAcceleration">,
    onClose: () => void,
    onRows: (rows: number) => void,
  ) {
    this.renderer = shell.renderer;
    this.onRows = onRows;
    this.theme = shell.theme;
    this.container = new BoxRenderable(shell.renderer, {
      id: shell.nextId("usage"),
      height: this.rows,
      flexShrink: 0,
      flexDirection: "column",
      backgroundColor: shell.theme.background,
      focusable: true,
      paddingX: 1,
    });
    const title = new TextRenderable(shell.renderer, {
      content: new StyledText([bold(fg(shell.theme.foreground)("Usage"))]),
      height: 1,
      flexShrink: 0,
      selectable: false,
    });
    this.scroll = new ScrollBoxRenderable(shell.renderer, {
      id: shell.nextId("usage-scroll"),
      flexGrow: 1,
      minHeight: 0,
      scrollX: false,
      scrollY: true,
      stickyScroll: false,
      scrollAcceleration: shell.newScrollAcceleration(),
      verticalScrollbarOptions: {
        trackOptions: {
          backgroundColor: shell.theme.scrollbarTrack,
          foregroundColor: shell.theme.scrollbarThumb,
        },
      },
    });
    this.text = new TextRenderable(shell.renderer, {
      id: shell.nextId("usage-text"),
      fg: shell.theme.foreground,
      flexShrink: 0,
      wrapMode: "word",
      selectable: true,
      selectionBg: shell.theme.selectionBackground,
      selectionFg: shell.theme.selectionForeground,
    });
    this.scroll.add(this.text);
    this.container.add(title);
    this.container.add(this.scroll);

    const onSizeChange = this.scroll.viewport.onSizeChange;
    this.scroll.viewport.onSizeChange = () => {
      onSizeChange?.call(this.scroll.viewport);
      this.paint();
    };
    const unregister = registerChatLayer(shell.keymap, {
      enabled: () => !this.container.isDestroyed,
      commands: {
        "chat.interrupt": {
          title: "Close usage",
          run: () => {
            onClose();
            return true;
          },
        },
        "chat.history.previous": {
          title: "Scroll usage up",
          run: () => {
            this.scroll.scrollBy(-1);
            return true;
          },
        },
        "chat.history.next": {
          title: "Scroll usage down",
          run: () => {
            this.scroll.scrollBy(1);
            return true;
          },
        },
        "chat.scroll.page.up": {
          title: "Page usage up",
          run: () => {
            this.scroll.scrollBy(-1, "viewport");
            return true;
          },
        },
        "chat.scroll.page.down": {
          title: "Page usage down",
          run: () => {
            this.scroll.scrollBy(1, "viewport");
            return true;
          },
        },
      },
    });
    shell.renderer.on(CliRenderEvents.RESIZE, this.resize);
    this.container.once(RenderableEvents.DESTROYED, () => {
      unregister();
      shell.renderer.off(CliRenderEvents.RESIZE, this.resize);
    });
    this.paint();
  }

  get rows(): number {
    return this.state.kind === "ready"
      ? Math.max(3, Math.min(16, Math.floor(this.renderer.height * 0.4)))
      : 2;
  }

  private readonly resize = (): void => {
    this.container.height = this.rows;
    this.onRows(this.rows);
  };

  update(state: UsagePanelState): void {
    if (this.container.isDestroyed) return;
    this.state = state;
    this.resize();
    this.paint();
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

  private paint(): void {
    if (this.container.isDestroyed) return;
    // Keep the same text and scroll renderables when local history arrives. Rebuilding
    // the content tree would reset the viewport and discard a text selection.
    // Percent widths can include the scrollbar column and clip a character at each wrap.
    this.text.width = Math.max(1, this.scroll.viewport.width);
    switch (this.state.kind) {
      case "loading":
        this.text.content = new StyledText([fg(this.theme.muted)("Reading usage…")]);
        return;
      case "ready":
        this.text.content = usageText(this.state.card, this.scroll.viewport.width, this.theme);
        return;
      case "failed":
        this.text.content = new StyledText([
          fg(this.theme.error)(`Failed to load usage: ${this.state.message}`),
        ]);
        return;
      default: {
        const exhaustive: never = this.state;
        return exhaustive;
      }
    }
  }
}

function usageText(card: UsageCard, width: number, theme: CliTheme): StyledText {
  const chunks = [
    fg(theme.foreground)("Recorded usage · API cost estimates, not subscription charges\n\n"),
  ];
  const line = (text: string): void => {
    chunks.push(fg(theme.foreground)(`${text}\n`));
  };
  const heading = (text: string): void => {
    chunks.push(bold(fg(theme.foreground)(`${text}\n`)));
  };
  const bar = (share: number, color: string): void => {
    const cells = Math.max(1, Math.min(BAR_CELLS, width - 2));
    const fill = share <= 0 ? 0 : Math.max(1, Math.min(cells, Math.round(share * cells)));
    chunks.push(fg(color)("━".repeat(fill)), fg(theme.muted)(GLYPHS.rule.repeat(cells - fill)));
  };
  const rows = (items: readonly UsageCardRow[]): void => {
    const labelCells = Math.max(0, ...items.map((row) => displayWidth(row.label)));
    for (const row of items) {
      const amounts = `${row.cost} · ${row.tokens} tokens`;
      const color = row.system ? theme.muted : theme.accent;
      if (labelCells + BAR_CELLS + displayWidth(amounts) + 4 <= width) {
        chunks.push(fg(theme.foreground)(`${padDisplay(row.label, labelCells)}  `));
        bar(row.share, color);
        line(`  ${amounts}`);
        continue;
      }
      line(row.label);
      line(amounts.trim());
      bar(row.share, color);
      line("");
    }
  };
  for (const account of card.accounts) {
    heading(`${account.provider === "anthropic" ? "Claude" : "Codex"} · account limits`);
    switch (account.kind) {
      case "unavailable":
        line("Limits unavailable · requires a Nyte subscription login");
        break;
      case "failed":
        line(account.message);
        break;
      case "ready":
        for (const window of account.limits.windows) {
          const label =
            window.id === "five_hour"
              ? "5 hours"
              : window.id === "seven_day"
                ? "Weekly"
                : window.id.startsWith("seven_day_")
                  ? `Weekly ${window.id.slice("seven_day_".length)}`
                  : window.id;
          const used = Math.round(window.usedPercent);
          const reset =
            window.resetsAt === undefined
              ? "reset unknown"
              : `resets ${new Date(window.resetsAt).toLocaleString(undefined, {
                  weekday: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}`;
          line(`${label} · ${String(used)}% used · ${String(100 - used)}% left · ${reset}`);
          bar(used / 100, used >= 95 ? theme.error : used >= 85 ? theme.warning : theme.accent);
          line("");
        }
        break;
      default: {
        const exhaustive: never = account;
        return exhaustive;
      }
    }
    line("");
  }
  const workspace = card.workspace;
  if (workspace.kind === "empty") {
    heading(`${workspace.title} · ${workspace.message}`);
  } else {
    heading(`${workspace.title} · ${workspace.total}`);
    rows(workspace.rows);
    line("");
    for (const breakdown of workspace.breakdown) line(breakdown);
    if (workspace.thisChat !== undefined) line(workspace.thisChat);
  }
  for (const [name, history] of [
    ["Claude Code", card.claudeCode],
    ["Codex", card.codex],
  ] as const) {
    line("");
    heading(`${name} · all local projects`);
    line("All-time local history · separate from this workspace");
    if (history.kind === "message") {
      line(history.message);
    } else {
      line(history.total);
      rows(history.rows);
      line("");
      for (const breakdown of history.breakdown) line(breakdown);
      for (const note of history.notes) line(note);
    }
  }
  return new StyledText(chunks);
}
