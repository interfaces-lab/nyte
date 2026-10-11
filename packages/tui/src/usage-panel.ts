import {
  bold,
  CliRenderEvents,
  fg,
  RenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import type { BoxRenderable } from "@opentui/core";
import { GLYPHS, keycap } from "./constants.ts";
import { registerChatLayer } from "./keymap.ts";
import type { EphemeralPanel, Shell } from "./app/ui.ts";
import type { CliTheme } from "./theme.ts";
import type { UsageCard } from "./usage.ts";
import { PanelLayout } from "./panel-layout.ts";

const BAR_CELLS = 20;

/** A read-only report. The shell owns focus; the native scroll box owns scrolling and selection. */
export class UsagePanel implements EphemeralPanel {
  readonly container: BoxRenderable;
  readonly layout: PanelLayout;
  private readonly onRows: (rows: number) => void;
  readonly hints = `${keycap("chat.interrupt")} close · ${keycap("chat.history.previous")}/${keycap("chat.history.next")} scroll · ${keycap("chat.scroll.page.up")}/${keycap("chat.scroll.page.down")} page`;
  private readonly scroll: ScrollBoxRenderable;
  private readonly text: TextRenderable;
  private readonly theme: CliTheme;
  private card: UsageCard;

  constructor(
    shell: Pick<Shell, "renderer" | "keymap" | "theme" | "nextId" | "newScrollAcceleration">,
    card: UsageCard,
    onClose: () => void,
    onRows: (rows: number) => void,
  ) {
    this.card = card;
    this.onRows = onRows;
    this.theme = shell.theme;
    this.layout = new PanelLayout({ ...shell, title: "Usage" });
    this.container = this.layout.container;
    this.container.focusable = true;
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
    this.layout.body.add(this.scroll);

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
    return this.layout.rows + 13;
  }

  private readonly resize = (): void => {
    this.onRows(this.rows);
  };

  update(card: UsageCard): void {
    if (this.container.isDestroyed) return;
    this.card = card;
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

    this.text.content = usageText(this.card, this.scroll.viewport.width, this.theme);
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

  for (const account of card.accounts) {
    heading(`${account.name} · account limits`);

    for (const window of account.limits) {
      const used = window.limit <= 0 ? 0 : Math.round((window.used / window.limit) * 100);

      const reset =
        window.resetsAt === null
          ? "reset unknown"
          : `resets ${new Date(window.resetsAt).toLocaleString(undefined, {
              weekday: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}`;

      line(`${window.label} · ${String(used)}% used · ${String(100 - used)}% left · ${reset}`);
      bar(used / 100, used >= 95 ? theme.error : used >= 85 ? theme.warning : theme.accent);
      line("");
    }

    line("");
  }

  const { chat } = card;

  if (chat.kind === "message") {
    heading(`this chat · ${chat.message}`);
  } else {
    heading(`this chat · ${chat.total}`);

    for (const breakdown of chat.breakdown) line(breakdown);
  }

  return new StyledText(chunks);
}
