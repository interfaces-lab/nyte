/**
 * Steer messages core is still holding, drawn at the transcript's tail. Enter
 * sends them to land at the next response boundary, so each is drawn exactly
 * as its turn will be once admitted: the same user block, and in the row the
 * run's status will take, the glyph and one word that say when it goes.
 * Admission then changes that row in place and moves nothing, so the message
 * is never seen in two places.
 *
 * A message keeps one block from sending through pending: the submission key
 * that named it while sending stays an alias of the block once the receipt
 * names its change, and core returns that key on the pending item itself. Follow-ups queued with ctrl+enter take the compact rows in
 * `pending-gutter.ts` instead.
 */
import { BoxRenderable, fg, StyledText, TextRenderable } from "@opentui/core";
import type { PendingItem } from "@nyte-ai/core";
import { pendingHint, SPACING } from "./constants.ts";
import type { DeliveryChoices } from "./lanes.ts";
import { rowContent, rowMark } from "./pending-gutter.ts";
import type { GutterRow, RowMark } from "./pending-gutter.ts";
import type { CliTheme } from "./theme.ts";
import { appendUser, repaintTree } from "./transcript.ts";
import type { Transcript } from "./transcript.ts";

/** Every name a row answers to; a pending item also answers to the key it was submitted under. */
function rowIds(row: GutterRow): readonly string[] {
  if (row.kind === "sending") return [`key:${row.entry.key}`];
  const ids = [`change:${row.item.change}`];
  if (row.item.key !== undefined) ids.push(`key:${row.item.key}`);
  return ids;
}

/** `<glyph> <word> · <key>` where the turn's status row will be. */
function statusLine(mark: RowMark, theme: CliTheme, hint: string | undefined): StyledText {
  const chunks = [fg(mark.tone)(`${mark.glyph} ${mark.label}`)];
  if (hint !== undefined) chunks.push(fg(theme.muted)(" · "), fg(theme.dim)(hint));
  return new StyledText(chunks);
}

/** A message drawn in the shape of the turn it becomes. */
interface PendingBlock {
  ids: readonly string[];
  readonly root: BoxRenderable;
  readonly status: TextRenderable;
}

/** The region itself. Hidden while nothing is pending, so an idle session gives its rows back. */
export class PendingTail {
  readonly container: BoxRenderable;
  onOpen: ((row: GutterRow) => void) | undefined;
  onReorder: ((item: PendingItem, before: PendingItem | null) => void) | undefined;
  private readonly transcript: Transcript;
  private roles: DeliveryChoices;
  private items: readonly GutterRow[] = [];
  private hint = true;
  private readonly blocks: PendingBlock[] = [];
  private drag: { readonly item: PendingItem; readonly index: number; moving: boolean } | undefined;

  constructor(transcript: Transcript, roles: DeliveryChoices) {
    this.transcript = transcript;
    this.roles = roles;
    this.container = new BoxRenderable(transcript.renderer, {
      id: "pending-tail",
      flexDirection: "column",
      flexShrink: 0,
      width: "100%",
      visible: false,
    });
  }

  retheme(): void {
    for (const block of this.blocks) repaintTree(block.root);
    this.repaint();
  }

  setRoles(roles: DeliveryChoices): void {
    this.roles = roles;
    this.repaint();
  }

  /** `hint` is false while the compact gutter below already carries the key that opens the queue. */
  sync(items: readonly GutterRow[], options: { readonly hint?: boolean } = {}): void {
    this.items = items;
    this.hint = options.hint ?? true;
    for (const [index, item] of items.entries()) {
      const ids = rowIds(item);
      const current = this.blocks[index];
      if (current !== undefined && current.ids.some((id) => ids.includes(id))) {
        current.ids = ids;
        continue;
      }
      const block = this.mount(item, current?.root);
      if (current !== undefined) this.unmount(current);
      this.blocks[index] = block;
    }
    for (const block of this.blocks.splice(items.length)) this.unmount(block);
    this.container.visible = items.length > 0;
    this.repaint();
  }

  private mount(item: GutterRow, before: BoxRenderable | undefined): PendingBlock {
    const { renderer, nextId } = this.transcript;
    const root = new BoxRenderable(renderer, {
      id: nextId("pending-turn"),
      flexDirection: "column",
      marginTop: SPACING.block,
      width: "100%",
      flexShrink: 0,
    });
    if (before === undefined) this.container.add(root);
    else this.container.insertBefore(root, before);
    appendUser(this.transcript, rowContent(item), root);
    // The same box the turn's activity row takes: block margin, one row, the transcript inset.
    const statusRow = new BoxRenderable(renderer, {
      id: nextId("pending-status"),
      height: 1,
      marginTop: SPACING.block,
      paddingLeft: SPACING.inset,
      paddingRight: SPACING.insetRight,
      width: "100%",
    });
    root.add(statusRow);
    const status = new TextRenderable(renderer, {
      id: nextId("pending-status-line"),
      content: "",
      height: 1,
      wrapMode: "none",
      truncate: true,
      selectable: false,
    });
    statusRow.add(status);
    status.onMouseOver = () => {
      status.bg = this.transcript.theme.hover;
    };
    status.onMouseOut = () => {
      status.bg = this.transcript.theme.transparent;
    };
    root.onMouseDown = (event) => {
      if (event.button !== 0) return;
      const index = this.blocks.findIndex((block) => block.root === root);
      const row = this.items[index];
      if (row === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      if (row.kind === "pending") {
        this.drag = { item: row.item, index, moving: false };
        return;
      }
      this.onOpen?.(row);
    };
    root.onMouseDrag = (event) => {
      if (this.drag === undefined) return;
      this.drag.moving = true;
      event.preventDefault();
      event.stopPropagation();
    };
    root.onMouseUp = () => {
      const drag = this.drag;
      this.drag = undefined;
      if (drag !== undefined && !drag.moving) this.onOpen?.({ kind: "pending", item: drag.item });
    };
    root.onMouseDragEnd = (event) => {
      const drag = this.drag;
      this.drag = undefined;
      if (drag === undefined || !drag.moving) return;
      const index = this.blocks.findIndex(
        (block) => event.y >= block.root.y && event.y < block.root.y + block.root.height,
      );
      const target = this.items[index];
      if (target?.kind === "pending" && target.item.delivery !== drag.item.delivery) return;
      if (index === drag.index) return;
      this.onReorder?.(drag.item, target?.kind === "pending" ? target.item : null);
      event.preventDefault();
      event.stopPropagation();
    };
    return { ids: rowIds(item), root, status };
  }

  private unmount(block: PendingBlock): void {
    this.container.remove(block.root);
    if (!block.root.isDestroyed) block.root.destroyRecursively();
  }

  private repaint(): void {
    const { theme } = this.transcript;
    for (const [index, block] of this.blocks.entries()) {
      const item = this.items[index];
      if (item === undefined) continue;
      const last = index === this.blocks.length - 1;
      block.status.content = statusLine(
        rowMark(item, this.roles, theme),
        theme,
        last && this.hint ? pendingHint(0) : undefined,
      );
    }
  }
}
