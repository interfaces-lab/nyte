import {
  bold,
  BoxRenderable,
  fg,
  MacOSScrollAccel,
  RenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
} from "@opentui/core";
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
  // Mounted over the root after openPanel, without borrowing transcript rows.
  readonly rows = 0;
  readonly hints = `${keycap("chat.interrupt")} close · ${keycap("chat.history.previous")}/${keycap("chat.history.next")} scroll · ${keycap("chat.scroll.page.up")}/${keycap("chat.scroll.page.down")} page`;
  private readonly scroll: ScrollBoxRenderable;
  private readonly text: TextRenderable;
  private readonly theme: CliTheme;
  private state: UsagePanelState = { kind: "loading" };

  constructor(shell: Pick<Shell, "renderer" | "keymap" | "theme" | "nextId">, onClose: () => void) {
    this.theme = shell.theme;
    this.container = new BoxRenderable(shell.renderer, {
      id: shell.nextId("usage"),
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
      scrollAcceleration: new MacOSScrollAccel(),
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
    const hints = new TextRenderable(shell.renderer, {
      content: this.hints,
      fg: shell.theme.dim,
      flexShrink: 0,
      wrapMode: "word",
      selectable: false,
    });
    this.scroll.add(this.text);
    this.container.add(title);
    this.container.add(this.scroll);
    this.container.add(hints);
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
    this.container.once(RenderableEvents.DESTROYED, unregister);
    this.paint();
  }

  update(state: UsagePanelState): void {
    if (this.container.isDestroyed) return;
    this.state = state;
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
    // Keep the same text and scroll renderables when headroom arrives. Rebuilding
    // the content tree would reset the viewport and discard a text selection.
    // Percent widths can include the scrollbar column and clip a character at each wrap.
    this.text.width = Math.max(1, this.scroll.viewport.width);
    switch (this.state.kind) {
      case "loading": {
        const skeleton = GLYPHS.rule.repeat(
          Math.max(1, Math.min(BAR_CELLS, this.scroll.viewport.width)),
        );
        this.text.content = new StyledText([
          fg(this.theme.foreground)("Loading workspace usage…\n\n"),
          fg(this.theme.muted)(`${skeleton}\n${skeleton}\n${skeleton}`),
        ]);
        return;
      }
      case "ready":
        this.text.content = usageText(this.state.card, this.scroll.viewport.width, this.theme);
        return;
      case "failed":
        this.text.content = new StyledText([
          fg(this.theme.error)(`Failed to load workspace usage: ${this.state.message}`),
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
  line("");
  heading("Claude Code · all local projects");
  line("All-time local history · separate from this workspace");
  const claudeCode = card.claudeCode;
  if (claudeCode.kind === "message") {
    line(claudeCode.message);
  } else {
    line(claudeCode.total);
    rows(claudeCode.rows);
    line("");
    for (const breakdown of claudeCode.breakdown) line(breakdown);
    for (const note of claudeCode.notes) line(note);
  }
  const headroom = card.headroom;
  if (headroom.kind !== "none") {
    line("");
    heading("Account limits");
  }
  switch (headroom.kind) {
    case "none":
      break;
    case "checking":
      line(`${headroom.name} · checking…`);
      break;
    case "unavailable":
      line(`${headroom.name} · not available`);
      break;
    case "known":
      line(`${headroom.name} · ${headroom.meta}${headroom.stale ? " (stale)" : ""}`);
      for (const window of headroom.windows) {
        line(`${window.label.trim()} · ${window.remaining.trim()} remaining · ${window.reset}`);
        bar(
          window.share,
          window.tone === "critical"
            ? theme.error
            : window.tone === "warning"
              ? theme.warning
              : theme.accent,
        );
        line("");
      }
      break;
    default: {
      const exhaustive: never = headroom;
      return exhaustive;
    }
  }
  return new StyledText(chunks);
}
