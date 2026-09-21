/**
 * Follow-ups core is still holding, drawn between the transcript and the
 * composer: the store's pending changes in the queue delivery, and the outbox's
 * rows on their way to it. Steer messages take the other shape, in
 * `pending-tail.ts`.
 *
 * These messages have not been answered, so they do not belong in the record.
 * One row per item: the glyph and one word say when it goes, and the row
 * closest to the composer carries the key that opens the queue.
 *
 * Based on opencode's queued user messages, which render with a QUEUED badge
 * until their turn begins:
 * https://github.com/anomalyco/opencode/blob/7cde8329bc33801248d6aafa2a4dd46dc86e5683/packages/tui/src/routes/session/index.tsx
 */
import { BoxRenderable, fg, StyledText, TextRenderable } from "@opentui/core";
import type { CliRenderer } from "@opentui/core";
import type { Delivery, PendingItem } from "@nyte-ai/core";
import type { UserMessage } from "@nyte-ai/schema";
import { GLYPHS, pendingHint } from "./constants.ts";
import { extractFileAttachments } from "./composer.ts";
import { basename } from "node:path";
import { userText } from "./format.ts";
import type { DeliveryChoices } from "./lanes.ts";
import type { OutboxRow } from "@nyte-ai/client";
import type { CliTheme } from "./theme.ts";
import { displayWidth, padDisplay, truncateDisplay } from "./width.ts";

/**
 * One row: a durable pending change, or a message the outbox is still sending.
 * A pending item carries the submission key that named it while sending, so
 * what draws it can keep the same block across the receipt.
 */
export type GutterRow =
  | { readonly kind: "pending"; readonly item: PendingItem }
  | { readonly kind: "sending"; readonly row: OutboxRow };

/** Durable first, oldest first; then what is still on its way. */
export function gutterRows(
  pending: readonly PendingItem[],
  sending: readonly OutboxRow[],
): GutterRow[] {
  return [
    ...pending.map((item): GutterRow => ({ kind: "pending", item })),
    ...sending.map((row): GutterRow => ({ kind: "sending", row })),
  ];
}

export function rowDelivery(row: GutterRow): Delivery | undefined {
  return row.kind === "pending" ? row.item.delivery : row.row.input.delivery;
}

export function rowContent(row: GutterRow): UserMessage["content"] {
  return row.kind === "pending" ? row.item.content : row.row.input.content;
}

/** The gutter never takes more than this share of the terminal. */
const MAX_ROW_SHARE = 0.3;
const MIN_ROWS = 1;

function gutterRowLimit(terminalHeight: number): number {
  return Math.max(MIN_ROWS, Math.floor(terminalHeight * MAX_ROW_SHARE));
}

/** Below this the message is a stub, so the row sheds chrome to keep the text. */
const MIN_TEXT_COLUMNS = 12;
/** Leading space, glyph, trailing space. */
const LEAD_COLUMNS = 3;
const GAP_COLUMNS = 2;

export function queuedPromptText(content: UserMessage["content"]): string {
  const text = userText(content);
  const attachments = extractFileAttachments(text);
  const compact = attachments.reduce(
    (value, file) => value.replace(file.source, `[File ${basename(file.path)}]`),
    text,
  );
  const images = Array.isArray(content)
    ? content.filter((part) => part.type === "image").length
    : 0;
  return `${compact.replaceAll(/\s+/gu, " ").trim()}${images === 0 ? "" : ` · ${images} ${images === 1 ? "image" : "images"}`}`;
}

export interface RowMark {
  readonly glyph: string;
  readonly label: string;
  readonly tone: string;
}

/** The glyph and word for a delivery. */
export function deliveryMark(delivery: Delivery, roles: DeliveryChoices, theme: CliTheme): RowMark {
  if (delivery === roles.steer) return { glyph: GLYPHS.steer, label: delivery, tone: theme.accent };
  return { glyph: GLYPHS.queue, label: delivery, tone: theme.warning };
}

export function rowMark(row: GutterRow, roles: DeliveryChoices, theme: CliTheme): RowMark {
  switch (row.kind) {
    case "pending":
      return deliveryMark(row.item.delivery, roles, theme);
    case "sending": {
      const { state } = row.row;
      const attempts = "attempts" in state ? state.attempts : 1;
      return {
        glyph: GLYPHS.sending,
        label: attempts > 1 ? `sending (retry ${String(attempts - 1)})` : "sending",
        tone: theme.dim,
      };
    }
    default: {
      const _exhaustive: never = row;
      return _exhaustive;
    }
  }
}

/**
 * `<glyph> <message>   <word> · <key>`, with the message taking whatever the
 * fixed parts leave. Chrome goes before the delivery word when the terminal
 * narrows.
 */
function pendingRow(
  text: string,
  mark: RowMark,
  width: number,
  theme: CliTheme,
  hint?: string,
): StyledText {
  const room = Math.max(0, Math.floor(width));
  const lead = ` ${mark.glyph} `;
  if (room <= LEAD_COLUMNS) {
    return new StyledText([fg(mark.tone)(padDisplay(truncateDisplay(lead, room), room))]);
  }
  const fixed = LEAD_COLUMNS + 1;
  const fits = (right: string): boolean =>
    room - fixed - GAP_COLUMNS - displayWidth(right) >= MIN_TEXT_COLUMNS;
  const showLabel = fits(mark.label);
  const showHint = hint !== undefined && fits(`${mark.label} · ${hint}`);
  const textRoom = Math.max(
    0,
    room -
      fixed -
      (showLabel ? GAP_COLUMNS + displayWidth(mark.label) : 0) -
      (showHint ? displayWidth(` · ${hint}`) : 0),
  );
  const chunks = [
    fg(mark.tone)(lead),
    fg(theme.user)(padDisplay(truncateDisplay(text, textRoom, GLYPHS.ellipsis), textRoom)),
  ];
  if (showLabel) chunks.push(fg(theme.muted)("  "), fg(mark.tone)(mark.label));
  if (showHint) chunks.push(fg(theme.muted)(" · "), fg(theme.dim)(hint));
  chunks.push(fg(theme.muted)(" "));
  return new StyledText(chunks);
}

/** The region itself. Hidden while nothing is pending, so an idle session gives its rows back. */
export class PendingGutter {
  readonly container: BoxRenderable;
  onOpen: ((row: GutterRow) => void) | undefined;
  onReorder: ((item: PendingItem, before: PendingItem | null) => void) | undefined;
  private readonly renderer: CliRenderer;
  private readonly theme: CliTheme;
  private readonly nextId: (prefix?: string) => string;
  private roles: DeliveryChoices;
  private items: readonly GutterRow[] = [];
  private readonly rows: TextRenderable[] = [];
  private drag: { readonly item: PendingItem; readonly index: number; moving: boolean } | undefined;

  constructor(
    renderer: CliRenderer,
    theme: CliTheme,
    roles: DeliveryChoices,
    nextId: (prefix?: string) => string,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.roles = roles;
    this.nextId = nextId;
    this.container = new BoxRenderable(renderer, {
      id: "pending-gutter",
      flexDirection: "column",
      flexShrink: 0,
      visible: false,
      backgroundColor: theme.terminal,
      marginLeft: 1,
      marginRight: 1,
    });
    this.container.onSizeChange = this.repaint;
  }

  /** A shorter terminal fits fewer rows, so the cap is re-taken on resize. */
  resize(): void {
    this.sync(this.items);
  }

  retheme(): void {
    this.container.backgroundColor = this.theme.terminal;
    this.repaint();
  }

  setRoles(roles: DeliveryChoices): void {
    this.roles = roles;
    this.repaint();
  }

  sync(items: readonly GutterRow[]): void {
    this.items = items;
    this.setRowCount(Math.min(items.length, gutterRowLimit(this.renderer.height)));
    this.repaint();
  }

  private setRowCount(count: number): void {
    while (this.rows.length > count) {
      const row = this.rows.pop();
      if (row === undefined) continue;
      this.container.remove(row);
      if (!row.isDestroyed) row.destroyRecursively();
    }
    while (this.rows.length < count) {
      const row = new TextRenderable(this.renderer, {
        id: this.nextId("pending-row"),
        content: "",
        height: 1,
        wrapMode: "none",
        selectable: false,
      });
      this.rows.push(row);
      this.container.add(row);
      row.onMouseOver = () => {
        row.bg = this.theme.hover;
      };
      row.onMouseOut = () => {
        row.bg = this.theme.terminal;
      };
      row.onMouseDown = (event) => {
        if (event.button !== 0) return;
        const index = this.rows.indexOf(row);
        const item = this.items[index];
        if (item === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        if (item.kind === "pending" && event.x < row.x + LEAD_COLUMNS) {
          this.drag = { item: item.item, index, moving: false };
          return;
        }
        this.onOpen?.(item);
      };
      row.onMouseDrag = (event) => {
        if (this.drag === undefined) return;
        this.drag.moving = true;
        event.preventDefault();
        event.stopPropagation();
      };
      row.onMouseUp = () => {
        const drag = this.drag;
        this.drag = undefined;
        if (drag !== undefined && !drag.moving) this.onOpen?.({ kind: "pending", item: drag.item });
      };
      row.onMouseDragEnd = (event) => {
        const drag = this.drag;
        this.drag = undefined;
        if (drag === undefined || !drag.moving) return;
        const index = this.rows.findIndex(
          (candidate) => event.y >= candidate.y && event.y < candidate.y + candidate.height,
        );
        const target = this.items[index];
        if (target?.kind === "pending" && target.item.delivery !== drag.item.delivery) return;
        if (index === drag.index) return;
        this.onReorder?.(drag.item, target?.kind === "pending" ? target.item : null);
        event.preventDefault();
        event.stopPropagation();
      };
    }
    this.container.visible = count > 0;
  }

  private readonly repaint = (): void => {
    const width =
      this.container.width > 0 ? this.container.width : Math.max(0, this.renderer.width - 2);
    const shown = this.rows.length;
    const hidden = this.items.length - shown;
    for (const [index, row] of this.rows.entries()) {
      const item = this.items[index];
      if (item === undefined) continue;
      const last = index === shown - 1;
      const text = queuedPromptText(rowContent(item));
      row.content = pendingRow(
        text,
        rowMark(item, this.roles, this.theme),
        width,
        this.theme,
        last ? pendingHint(hidden) : undefined,
      );
    }
  };
}
