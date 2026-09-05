import { createTextAttributes, parseColor, Renderable, ScrollBoxRenderable } from "@opentui/core";
import type {
  CliRenderer,
  KeyEvent,
  MouseEvent,
  OptimizedBuffer,
  RenderableOptions,
  RGBA,
} from "@opentui/core";
import { GLYPHS } from "./constants.ts";
import type { CliTheme } from "./theme.ts";
import { displayWidth, padDisplay, truncateDisplay } from "./width.ts";

/** Row text is cut to the cells it has, with a marker that it was cut. */
function truncate(text: string, width: number): string {
  return width <= 1 ? truncateDisplay(text, width) : truncateDisplay(text, width, GLYPHS.ellipsis);
}

export interface MenuStatus {
  readonly text: string;
  readonly tone: "dim" | "ok";
}

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly status?: MenuStatus;
}

interface MenuListOptions {
  readonly renderer: CliRenderer;
  readonly theme: CliTheme;
  readonly nextId: (prefix?: string) => string;
  /** Row background when a row is neither selected nor hovered. */
  readonly background: string;
  /** Most rows shown at once; the list scrolls past this. */
  readonly maxVisible: number;
  readonly items?: readonly MenuItem[];
  readonly selectedIndex?: number;
  readonly onSelect: (item: MenuItem, index: number) => void;
  /** Fires when navigation moves the highlight, not when it is chosen. */
  readonly onHighlight?: (item: MenuItem, index: number) => void;
}

/** Prefix (`❯ ` on the selected row) plus the gap between label and description. */
const PREFIX_WIDTH = 2;
const LABEL_GAP = 4;
/** Below this, a complete label is worth more than a clipped second column. */
const DETAIL_MIN_WIDTH = 48;

interface MenuRowsOptions extends RenderableOptions<MenuRows> {
  readonly theme: CliTheme;
  readonly background: string;
  readonly onSelectionChanged: (index: number) => void;
}

/**
 * The rows themselves: which item is current, what moving does to it, and how
 * a row looks. It draws straight onto the screen buffer, and it is as tall as
 * it has items, so the enclosing scroll box is the only thing that scrolls.
 */
class MenuRows extends Renderable {
  private items: readonly MenuItem[] = [];
  private selected = 0;
  private hovered: number | undefined;
  private readonly notifySelectionChanged: (index: number) => void;
  private rowBackground: RGBA;
  private selectedBackground: RGBA;
  private selectedForeground: RGBA;
  private hoverBackground: RGBA;
  private foreground: RGBA;
  private dim: RGBA;
  private ok: RGBA;
  private readonly boldAttributes = createTextAttributes({ bold: true });

  constructor(ctx: CliRenderer, options: MenuRowsOptions) {
    super(ctx, options);
    this.notifySelectionChanged = options.onSelectionChanged;
    this.rowBackground = parseColor(options.background);
    this.selectedBackground = parseColor(options.theme.selectionBackground);
    this.selectedForeground = parseColor(options.theme.selectionForeground);
    this.hoverBackground = parseColor(options.theme.hover);
    this.foreground = parseColor(options.theme.foreground);
    this.dim = parseColor(options.theme.dim);
    this.ok = parseColor(options.theme.ok);
  }

  retheme(theme: CliTheme, background: string): void {
    this.rowBackground = parseColor(background);
    this.selectedBackground = parseColor(theme.selectionBackground);
    this.selectedForeground = parseColor(theme.selectionForeground);
    this.hoverBackground = parseColor(theme.hover);
    this.foreground = parseColor(theme.foreground);
    this.dim = parseColor(theme.dim);
    this.ok = parseColor(theme.ok);
    this.requestRender();
  }

  setItems(items: readonly MenuItem[], selectedIndex: number): void {
    this.hovered = undefined;
    this.items = items;
    this.height = Math.max(1, items.length);
    this.setSelectedIndex(selectedIndex);
    this.requestRender();
  }

  getSelectedIndex(): number {
    return this.selected;
  }

  setSelectedIndex(index: number): void {
    const next = Math.min(Math.max(0, index), Math.max(0, this.items.length - 1));
    if (next === this.selected) return;
    this.selected = next;
    this.requestRender();
    this.notifySelectionChanged(next);
  }

  /** Step with wrap-around, so down from the last row lands on the first. */
  moveBy(steps: number): void {
    const count = this.items.length;
    if (count > 0) this.setSelectedIndex((((this.selected + steps) % count) + count) % count);
  }

  /** Local y is the item index, because this renderable never scrolls itself. */
  indexAt(y: number): number | undefined {
    const index = y - this.screenY;
    return index >= 0 && index < this.items.length ? index : undefined;
  }

  setHovered(index: number | undefined): void {
    if (index === this.hovered) return;
    this.hovered = index;
    this.requestRender();
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return;
    const left = this.x;
    const top = this.y;
    buffer.fillRect(left, top, this.width, this.height, this.rowBackground);
    const labelColumn = this.labelColumnWidth(this.width - PREFIX_WIDTH);
    for (const [index, item] of this.items.entries()) {
      const selected = index === this.selected;
      const background = selected
        ? this.selectedBackground
        : index === this.hovered
          ? this.hoverBackground
          : this.rowBackground;
      buffer.fillRect(left, top + index, this.width, 1, background);
      buffer.drawText(
        selected ? `${GLYPHS.prompt} ` : "  ",
        left,
        top + index,
        selected ? this.selectedForeground : this.foreground,
        background,
      );
      buffer.drawText(
        padDisplay(truncate(item.label, labelColumn), labelColumn),
        left + PREFIX_WIDTH,
        top + index,
        selected ? this.selectedForeground : this.foreground,
        background,
        selected ? this.boldAttributes : undefined,
      );
      const width = this.width - PREFIX_WIDTH - labelColumn - LABEL_GAP;
      const description = item.description ?? "";
      const separator = description === "" || item.status === undefined ? "" : " · ";
      const detail = `${description}${separator}${item.status?.text ?? ""}`;
      if (this.width < DETAIL_MIN_WIDTH || detail === "" || width <= 0) continue;
      const descriptionLeft = left + PREFIX_WIDTH + labelColumn;
      buffer.drawText(
        `${" ".repeat(LABEL_GAP)}${truncate(detail, width)}`,
        descriptionLeft,
        top + index,
        selected ? this.selectedForeground : this.dim,
        background,
      );
      if (item.status?.tone === "ok") {
        const statusOffset = displayWidth(`${description}${separator}`);
        const statusWidth = width - statusOffset;
        if (statusWidth > 0) {
          buffer.drawText(
            truncate(item.status.text, statusWidth),
            descriptionLeft + LABEL_GAP + statusOffset,
            top + index,
            selected ? this.selectedForeground : this.ok,
            background,
          );
        }
      }
    }
  }

  private labelColumnWidth(contentWidth: number): number {
    const widest = Math.max(0, ...this.items.map((item) => displayWidth(item.label)));
    return Math.max(1, Math.min(widest, contentWidth));
  }
}

/**
 * Single-line menu rows: `❯ label  description`, labels in one aligned
 * column, the selected row drawn as a bold band. Shared by the choice dialog
 * and the slash dropdown so both feel like one control.
 *
 * Based on https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/src/views/slash_dropdown.rs
 */
export class MenuList {
  readonly container: ScrollBoxRenderable;

  private readonly rows: MenuRows;
  private readonly onSelect: (item: MenuItem, index: number) => void;
  private readonly onHighlight: ((item: MenuItem, index: number) => void) | undefined;
  private maxVisible: number;
  private items: readonly MenuItem[] = [];

  constructor(options: MenuListOptions) {
    this.maxVisible = Math.max(1, Math.floor(options.maxVisible));
    this.onSelect = options.onSelect;
    this.onHighlight = options.onHighlight;

    this.container = new ScrollBoxRenderable(options.renderer, {
      id: options.nextId("menu"),
      width: "100%",
      scrollY: true,
      scrollX: false,
      verticalScrollbarOptions: { showArrows: false },
      horizontalScrollbarOptions: { visible: false },
      contentOptions: { flexDirection: "column" },
    });
    this.rows = new MenuRows(options.renderer, {
      id: options.nextId("menu-rows"),
      width: "100%",
      height: 1,
      theme: options.theme,
      background: options.background,
      onSelectionChanged: (index) => {
        this.scrollIntoView(index);
        const item = this.items[index];
        if (item !== undefined) this.onHighlight?.(item, index);
      },
      onMouseDown: (event: MouseEvent) => this.onMouseDown(event),
      onMouseMove: (event: MouseEvent) => this.rows.setHovered(this.rows.indexAt(event.y)),
      onMouseOut: () => this.rows.setHovered(undefined),
    });
    this.container.add(this.rows);
    // Scrolling before Yoga sizes the content is clamped to zero. Restore
    // the selected row after the scrollbox updates its actual bounds.
    this.container.content.on("resize", () => this.scrollIntoView(this.selectedIndex));
    this.container.viewport.on("resize", () => this.scrollIntoView(this.selectedIndex));
    this.setItems(options.items ?? [], options.selectedIndex ?? 0);
  }

  get selectedIndex(): number {
    return this.rows.getSelectedIndex();
  }

  get selectedItem(): MenuItem | undefined {
    return this.items[this.selectedIndex];
  }

  private get visibleCount(): number {
    return Math.min(this.items.length, this.maxVisible);
  }

  retheme(theme: CliTheme, background: string): void {
    this.rows.retheme(theme, background);
  }

  setMaxVisible(maxVisible: number): void {
    const next = Math.max(1, Math.floor(maxVisible));
    if (next === this.maxVisible) return;
    this.maxVisible = next;
    this.resizeViewport();
  }

  setItems(items: readonly MenuItem[], selectedIndex = 0): void {
    this.items = items;
    this.rows.setItems(items, selectedIndex);
    this.resizeViewport();
    this.container.scrollTo(0);
    this.scrollIntoView(this.selectedIndex);
  }

  /** Arrow, emacs and tab navigation plus paging. Enter and plain letters are the caller's. */
  handleNavigationKey(key: KeyEvent): boolean {
    if (this.items.length === 0) return false;
    const page = Math.max(1, this.maxVisible - 1);
    if (key.name === "up" || (key.name === "p" && key.ctrl) || (key.name === "tab" && key.shift)) {
      this.rows.moveBy(-1);
    } else if (
      key.name === "down" ||
      (key.name === "n" && key.ctrl) ||
      (key.name === "tab" && !key.shift)
    ) {
      this.rows.moveBy(1);
    } else if (key.name === "pageup") {
      this.rows.setSelectedIndex(Math.max(0, this.selectedIndex - page));
    } else if (key.name === "pagedown") {
      this.rows.setSelectedIndex(Math.min(this.items.length - 1, this.selectedIndex + page));
    } else {
      return false;
    }
    return true;
  }

  /** Choose the selected row, as enter would. */
  selectCurrent(): void {
    const item = this.selectedItem;
    if (item !== undefined) this.onSelect(item, this.selectedIndex);
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    const index = this.rows.indexAt(event.y);
    if (index === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.rows.setSelectedIndex(index);
    this.selectCurrent();
  }

  private resizeViewport(): void {
    this.container.height = Math.max(1, this.visibleCount);
  }

  private scrollIntoView(index: number): void {
    const height = this.container.viewport.height;
    if (height === 0) return;
    const top = this.container.scrollTop;
    if (index < top) this.container.scrollTo(index);
    else if (index >= top + height) this.container.scrollTo(index - height + 1);
  }
}
