import { matchesKey, matchesKeyName } from "./keymap.ts";
/**
 * The session tree as a picker: every commit on every branch, the head's path
 * marked, one row highlighted. Enter hands the highlighted commit back to the
 * shell, which decides what a move to it means. It takes the composer's place
 * while it is open, the way pi's does.
 *
 * Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/modes/interactive/components/tree-selector.ts
 */
import {
  CliRenderEvents,
  createTextAttributes,
  fg,
  InputRenderableEvents,
  parseColor,
  Renderable,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
} from "@opentui/core";
import type {
  BoxRenderable,
  CliRenderer,
  InputRenderable,
  KeyEvent,
  MouseEvent,
  OptimizedBuffer,
  RenderableOptions,
  RGBA,
} from "@opentui/core";
import type { CommitId, TreeNode, TreeView } from "@nyte-ai/sdk";
import { GLYPHS, keycap } from "./constants.ts";
import type { CliTheme } from "./theme.ts";
import { PanelLayout } from "./panel-layout.ts";
import { displayWidth, truncateDisplay } from "./width.ts";

/**
 * `default` hides bookkeeping and text-less assistant steps; `no-tools` also
 * hides tool results; `users` keeps only what you sent; `all` hides nothing.
 */
export type TreeFilter = "default" | "no-tools" | "users" | "all";

const FILTER_CYCLE: readonly TreeFilter[] = ["default", "no-tools", "users", "all"];

type TreeRole = "user" | "assistant" | "tool" | "checkpoint" | "summary";

/** One commit of the tree with the rows under it, built from the view's flat nodes. */
interface TreeItem {
  readonly node: TreeNode;
  readonly children: TreeItem[];
}

/** The tree as the selector lays it out: its roots and the head's tip. */
interface SessionTree {
  readonly tip: CommitId | null;
  readonly roots: readonly TreeItem[];
}

/** One drawn row of the tree. */
interface TreeRow {
  readonly oid: CommitId;
  readonly node: TreeItem;
  /** Gutters, connectors, and the fold glyph, three cells per level. */
  readonly prefix: string;
  /** Drawn with a connector: the first row of a branch. */
  readonly connector: boolean;
  /** Has rows under it that a fold would hide. */
  readonly foldable: boolean;
  readonly folded: boolean;
  /** On the path from the root to the head's tip. */
  readonly active: boolean;
  /** Head names whose tip is this commit. */
  readonly heads: readonly string[];
  readonly role: TreeRole;
  /** The role word before the text, e.g. `user:`. */
  readonly label: string;
  readonly text: string;
}

interface Gutter {
  readonly position: number;
  readonly show: boolean;
}

interface VisibleNode {
  readonly node: TreeItem;
  readonly children: VisibleNode[];
}

interface Described {
  readonly role: TreeRole;
  readonly label: string;
  readonly text: string;
}

const MAX_TEXT_CHARS = 200;

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, MAX_TEXT_CHARS);
}

/** Returns the row a commit draws as, from its kind, its part kind and core's one-line preview. */
function describe(item: TreeItem): Described | undefined {
  const { node } = item;
  const text = oneLine(node.preview);

  switch (node.kind) {
    case "user":
      return { role: "user", label: "user:", text };
    case "compaction":
      return { role: "checkpoint", label: "[compaction]", text };
    case "branchSummary":
      return { role: "summary", label: "[branch summary]:", text };
    case "part":
      if (node.partKind === "text")
        return {
          role: "assistant",
          label: "assistant:",
          text: text === "" ? "(no content)" : text,
        };

      if (node.partKind === "thinking") return { role: "assistant", label: "thinking:", text };

      return {
        role: "tool",
        label: `[${node.partKind ?? "part"}${text === "" ? "" : `: ${text}`}]`,
        text: "",
      };
    default: {
      const _exhaustive: never = node.kind;

      return _exhaustive;
    }
  }
}

/** Whether a node shows under a filter; the head's tip always does. */
function passes(item: TreeItem, filter: TreeFilter, tip: CommitId | null): boolean {
  const { node } = item;

  if (node.id === tip || filter === "all") return true;
  const tool = node.kind === "part" && node.partKind !== "text" && node.partKind !== "thinking";

  switch (filter) {
    case "users":
      return node.kind === "user";
    case "no-tools":
      return !tool && node.partKind !== "thinking";
    case "default":
      return node.partKind !== "thinking";
    default: {
      const _exhaustive: never = filter;

      return _exhaustive;
    }
  }
}

function matches(described: Described, query: string): boolean {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/u).filter(Boolean);

  if (terms.length === 0) return true;
  const haystack = `${described.label} ${described.text}`.toLocaleLowerCase();

  return terms.every((term) => haystack.includes(term));
}

/** Hidden nodes drop out and their children attach to the nearest visible ancestor. */
function visibleForest(
  roots: readonly TreeItem[],
  keep: (node: TreeItem) => boolean,
): VisibleNode[] {
  const collect = (node: TreeItem): VisibleNode[] => {
    const children = node.children.flatMap(collect);

    return keep(node) ? [{ node, children }] : children;
  };

  return roots.flatMap(collect);
}

function containsActive(node: VisibleNode): boolean {
  return node.node.node.active || node.children.some(containsActive);
}

interface TreeLayoutOptions {
  readonly filter?: TreeFilter;
  readonly query?: string;
  /** Rows whose descendants are hidden. */
  readonly folded?: ReadonlySet<CommitId>;
}

/**
 * Flatten with pi's indentation: a branch point indents its children, the
 * first generation after a branch indents once more for grouping, and a
 * single-child chain stays flat. A folded branch row keeps its glyph and
 * drops everything under it.
 */
function layoutTree(tree: SessionTree, options: TreeLayoutOptions = {}): TreeRow[] {
  const filter = options.filter ?? "default";
  const query = options.query ?? "";
  const folded = options.folded ?? new Set<CommitId>();
  const described = new Map<CommitId, Described>();

  const describeOnce = (node: TreeItem): Described | undefined => {
    const found = described.get(node.node.id);

    if (found !== undefined) return found;
    const value = describe(node);
    if (value !== undefined) described.set(node.node.id, value);

    return value;
  };

  const forest = visibleForest(tree.roots, (node) => {
    const description = describeOnce(node);
    return (
      description !== undefined && passes(node, filter, tree.tip) && matches(description, query)
    );
  });

  const multipleRoots = forest.length > 1;
  const rows: TreeRow[] = [];

  const visit = (
    item: VisibleNode,
    indent: number,
    justBranched: boolean,
    showConnector: boolean,
    isLast: boolean,
    gutters: readonly Gutter[],
    isRoot: boolean,
  ): void => {
    const description = describeOnce(item.node);
    if (description === undefined) return;
    const displayIndent = multipleRoots ? Math.max(0, indent - 1) : indent;
    const connector = showConnector && !isRoot;
    const connectorPosition = connector ? displayIndent - 1 : -1;
    const foldable = connector && item.children.length > 0;
    const isFolded = foldable && folded.has(item.node.node.id);
    const cells: string[] = [];

    for (let cell = 0; cell < displayIndent * 3; cell++) {
      const level = Math.floor(cell / 3);
      const offset = cell % 3;
      const gutter = gutters.find((candidate) => candidate.position === level);

      if (gutter !== undefined) {
        cells.push(offset === 0 && gutter.show ? "│" : " ");
      } else if (connector && level === connectorPosition) {
        cells.push(
          offset === 0 ? (isLast ? "└" : "├") : offset === 1 ? foldGlyph(foldable, isFolded) : " ",
        );
      } else {
        cells.push(" ");
      }
    }

    rows.push({
      oid: item.node.node.id,
      node: item.node,
      prefix: cells.join(""),
      connector,
      foldable,
      folded: isFolded,
      active: item.node.node.active,
      // The current head sits at the tip, which the marker already says.
      heads: item.node.node.id === tree.tip ? [] : item.node.node.heads,
      ...description,
    });

    if (isFolded) return;

    const ordered = item.children.toSorted(
      (left, right) => Number(containsActive(right)) - Number(containsActive(left)),
    );

    const multiple = ordered.length > 1;
    const childIndent = multiple || (justBranched && indent > 0) ? indent + 1 : indent;

    const childGutters = connector
      ? [...gutters, { position: Math.max(0, displayIndent - 1), show: !isLast }]
      : gutters;

    for (const [index, child] of ordered.entries()) {
      visit(
        child,
        childIndent,
        multiple,
        multiple,
        index === ordered.length - 1,
        childGutters,
        false,
      );
    }
  };

  const orderedRoots = forest.toSorted(
    (left, right) => Number(containsActive(right)) - Number(containsActive(left)),
  );

  for (const [index, root] of orderedRoots.entries()) {
    visit(
      root,
      multipleRoots ? 1 : 0,
      multipleRoots,
      multipleRoots,
      index === orderedRoots.length - 1,
      [],
      true,
    );
  }

  return rows;
}

function foldGlyph(foldable: boolean, folded: boolean): string {
  if (!foldable) return "─";

  return folded ? "⊞" : "⊟";
}

/** Index of `oid`, else of its nearest ancestor with a row, else the last row. */
function nearestRowIndex(
  rows: readonly TreeRow[],
  parents: ReadonlyMap<CommitId, CommitId | null>,
  oid: CommitId | null,
): number {
  const index = new Map(rows.map((row, position) => [row.oid, position]));
  let current = oid;
  const seen = new Set<CommitId>();

  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const found = index.get(current);

    if (found !== undefined) return found;
    current = parents.get(current) ?? null;
  }

  return Math.max(0, rows.length - 1);
}

const PREFIX_WIDTH = 2;

const MAX_ROWS = 10;

const BODY_CHROME_ROWS = 2;

interface TreeRowsOptions extends RenderableOptions<TreeRows> {
  readonly theme: CliTheme;
  readonly viewport: ScrollBoxRenderable["viewport"];
  readonly onSelectionChanged: (index: number) => void;
}

/** Rows drawn straight onto the buffer, one per commit, as tall as the list. */
class TreeRows extends Renderable {
  private rows: readonly TreeRow[] = [];
  private selected = 0;
  private hovered: number | undefined;
  private readonly notifySelectionChanged: (index: number) => void;
  private readonly theme: CliTheme;
  private readonly viewport: ScrollBoxRenderable["viewport"];
  private readonly rowBackground: RGBA;
  private readonly selectedBackground: RGBA;
  private readonly hoverBackground: RGBA;
  private readonly boldAttributes = createTextAttributes({ bold: true });

  constructor(ctx: CliRenderer, options: TreeRowsOptions) {
    super(ctx, options);
    this.theme = options.theme;
    this.viewport = options.viewport;
    this.notifySelectionChanged = options.onSelectionChanged;
    this.rowBackground = parseColor(options.theme.transparent);
    this.selectedBackground = parseColor(options.theme.selectionBackground);
    this.hoverBackground = parseColor(options.theme.hover);
  }

  setRows(rows: readonly TreeRow[], selectedIndex: number): void {
    this.hovered = undefined;
    this.rows = rows;
    this.height = Math.max(1, rows.length);
    this.selected = -1;
    this.setSelectedIndex(selectedIndex);
  }

  getSelectedIndex(): number {
    return this.selected;
  }

  setSelectedIndex(index: number): void {
    const next = Math.min(Math.max(0, index), Math.max(0, this.rows.length - 1));

    if (next === this.selected) return;
    this.selected = next;
    this.requestRender();
    this.notifySelectionChanged(next);
  }

  /** Step with wrap-around, as pi's list does. */
  moveBy(steps: number): void {
    const count = this.rows.length;

    if (count > 0) this.setSelectedIndex((((this.selected + steps) % count) + count) % count);
  }

  indexAt(y: number): number | undefined {
    const index = y - this.screenY;

    return index >= 0 && index < this.rows.length ? index : undefined;
  }

  setHovered(index: number | undefined): void {
    if (index === this.hovered) return;
    this.hovered = index;
    this.requestRender();
  }

  private roleColor(row: TreeRow): string {
    switch (row.role) {
      case "user":
        return this.theme.accent;
      case "assistant":
        return row.text === "(aborted)" ? this.theme.warning : this.theme.ok;
      case "summary":
      case "checkpoint":
        return this.theme.warning;
      case "tool":
        return this.theme.muted;
      default: {
        const _exhaustive: never = row.role;

        return _exhaustive;
      }
    }
  }

  protected override renderSelf(buffer: OptimizedBuffer): void {
    if (!this.visible) return;
    const left = this.x;
    const top = this.y;
    const first = Math.max(0, this.viewport.screenY - this.screenY, -top);

    const end = Math.min(
      this.height,
      this.viewport.screenY + this.viewport.height - this.screenY,
      buffer.height - top,
    );

    if (end > first)
      buffer.fillRect(left, top + first, this.width, end - first, this.rowBackground);
    const textWidth = this.width - PREFIX_WIDTH;

    for (let index = first; index < end; index += 1) {
      const row = this.rows[index];

      if (row === undefined) continue;
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
        parseColor(selected ? this.theme.selectionForeground : this.theme.accent),
        background,
      );

      if (textWidth <= 0) continue;
      const attributes = selected ? this.boldAttributes : undefined;
      let x = left + PREFIX_WIDTH;
      let remaining = textWidth;

      const draw = (text: string, color: string): void => {
        if (remaining <= 0 || text === "") return;
        const shown = truncateDisplay(text, remaining, remaining > 1 ? GLYPHS.ellipsis : "");
        const foreground = selected ? this.theme.selectionForeground : color;
        buffer.drawText(shown, x, top + index, parseColor(foreground), background, attributes);
        const width = displayWidth(shown);
        x += width;
        remaining -= width;
      };

      draw(row.prefix, this.theme.dim);

      if (row.active) draw("• ", this.theme.accent);

      for (const head of row.heads) draw(`[${head}] `, this.theme.warning);
      draw(row.label, this.roleColor(row));

      if (row.text !== "") draw(` ${row.text}`, this.theme.foreground);
    }
  }
}

interface TreeSelectorOptions {
  readonly tree?: TreeView;
  readonly load?: () => Promise<TreeView>;
  /** Initial highlight; defaults to the head's tip. */
  readonly selectedOid?: CommitId | null;
  /** Rows to show first. */
  readonly filter?: TreeFilter;
}

interface TreeSelectorShell {
  readonly renderer: CliRenderer;
  readonly theme: CliTheme;
  readonly nextId: (prefix?: string) => string;
  readonly onRows: (rows: number) => void;
  readonly onSelect: (oid: CommitId) => void;
  readonly onCancel: () => void;
  readonly onError: (cause: unknown) => void;
}

function consume(key: KeyEvent): void {
  key.preventDefault();
  key.stopPropagation();
}

/** The tree picker itself: title, help, search, rows, and a count. */
export class TreeSelector {
  readonly container: BoxRenderable;
  readonly queryInput: InputRenderable;

  private readonly renderer: CliRenderer;
  private tree: SessionTree | undefined;
  private readonly parents = new Map<CommitId, CommitId | null>();
  private readonly panel: PanelLayout;
  private loading = false;
  private readonly footer: TextRenderable;
  private readonly empty: TextRenderable;
  private readonly scroll: ScrollBoxRenderable;
  private readonly list: TreeRows;
  private readonly onSelect: (oid: CommitId) => void;
  private readonly onCancel: () => void;
  private readonly onRows: (rows: number) => void;
  private readonly theme: CliTheme;
  private readonly folded = new Set<CommitId>();
  private layout: TreeRow[] = [];
  private filter: TreeFilter;
  private query = "";
  private filtering = true;
  private maxVisible = MAX_ROWS;
  private lastSelected: CommitId | null | undefined;
  private destroyed = false;

  constructor(shell: TreeSelectorShell, options: TreeSelectorOptions) {
    this.renderer = shell.renderer;
    this.onSelect = shell.onSelect;
    this.onCancel = shell.onCancel;
    this.onRows = shell.onRows;
    this.theme = shell.theme;
    this.filter = options.filter ?? "default";
    this.lastSelected = options.selectedOid;
    this.loading = options.load !== undefined;
    const { theme, nextId } = shell;
    this.panel = new PanelLayout({ ...shell, title: "Session Tree" });
    this.container = this.panel.container;

    const line = (id: string, content: StyledText | string): TextRenderable =>
      new TextRenderable(shell.renderer, {
        id: nextId(id),
        content,
        height: 1,
        flexShrink: 0,
        wrapMode: "none",
      });

    this.panel.body.add(
      line(
        "tree-help",
        new StyledText([
          fg(theme.dim)(
            `${keycap("tree.page.up", "symbol")}/${keycap("tree.page.down", "symbol")} page · ${keycap("tree.fold", "symbol").replace("meta+", "alt+")}/${keycap("tree.unfold", "symbol").replace("meta+", "")} fold · ${keycap("tree.copy")} copy · ${keycap("tree.filter.tools")}/${keycap("tree.filter.users").replace("ctrl+", "")}/${keycap("tree.filter.all").replace("ctrl+", "")}/${keycap("tree.filter.default").replace("ctrl+", "")} filter · ${keycap("tree.filter.next")} cycle`,
          ),
        ]),
      ),
    );
    this.queryInput = this.panel.addSearch("type to filter");

    this.scroll = new ScrollBoxRenderable(shell.renderer, {
      id: nextId("tree-scroll"),
      width: "100%",
      flexShrink: 1,
      minHeight: 0,
      scrollY: true,
      scrollX: false,
      verticalScrollbarOptions: { showArrows: false },
      horizontalScrollbarOptions: { visible: false },
      contentOptions: { flexDirection: "column" },
    });
    this.list = new TreeRows(shell.renderer, {
      id: nextId("tree-rows"),
      width: "100%",
      height: 1,
      theme,
      viewport: this.scroll.viewport,
      onSelectionChanged: (selected) => {
        this.scrollIntoView(selected);
        this.lastSelected = this.layout[selected]?.oid ?? this.lastSelected;
        this.paintFooter();
      },
      // The scroll box clamps offsets to 0 until it is laid out; scroll again once it is.
      onSizeChange: () => this.scrollIntoView(this.list.getSelectedIndex()),
      onMouseDown: (event: MouseEvent) => this.onMouseDown(event),
      onMouseMove: (event: MouseEvent) => this.list.setHovered(this.list.indexAt(event.y)),
      onMouseOut: () => this.list.setHovered(undefined),
    });
    this.scroll.add(this.list);
    this.scroll.viewport.on("resize", () => this.scrollIntoView(this.list.getSelectedIndex()));
    this.empty = line("tree-empty", new StyledText([fg(theme.dim)("  No entries found")]));
    this.empty.visible = false;
    this.footer = line("tree-footer", "");

    this.panel.body.add(this.scroll);
    this.panel.body.add(this.empty);
    this.panel.body.add(this.footer);
    this.panel.body.onSizeChange = () => this.resizeList();
    shell.renderer.keyInput.on("keypress", this.onKeyPress);
    shell.renderer.on(CliRenderEvents.RESIZE, this.onResize);
    this.queryInput.on(InputRenderableEvents.INPUT, this.onInput);
    if (options.tree !== undefined) this.update(options.tree);
    else this.relayout();
    if (options.load !== undefined) {
      this.loading = true;
      this.relayout();
      this.panel.load(
        options.load,
        (tree) => this.update(tree),
        (cause) => {
          this.loading = false;
          this.relayout();
          shell.onError(cause);
        },
      );
    }
  }

  /** Lays out a tree view: its flat nodes, parents first, become rows under their parents. */
  update(view: TreeView): void {
    if (this.destroyed) return;
    this.panel.cancelLoad();
    const tip = view.tip.kind === "commit" ? view.tip.id : null;
    const items = new Map<CommitId, TreeItem>();
    const roots: TreeItem[] = [];
    this.parents.clear();

    for (const node of view.nodes) {
      const item: TreeItem = { node, children: [] };
      items.set(node.id, item);
      this.parents.set(node.id, node.parent);
      const parent = node.parent === null ? undefined : items.get(node.parent);

      if (parent === undefined) roots.push(item);
      else parent.children.push(item);
    }

    this.tree = { tip, roots };

    if (this.lastSelected === undefined) this.lastSelected = tip;
    this.loading = false;
    this.relayout();
  }

  get hints(): string {
    return `${keycap("picker.accept")} select · ${keycap("picker.previous", "symbol")}${keycap("picker.next", "symbol")} move · ${keycap("tree.close")} close`;
  }

  get rows(): number {
    return this.panel.rows + BODY_CHROME_ROWS + Math.max(1, Math.min(this.layout.length, MAX_ROWS));
  }

  get selectedOid(): CommitId | undefined {
    return this.layout[this.list.getSelectedIndex()]?.oid;
  }

  focus(): void {
    this.queryInput.focus();
  }

  blur(): void {
    this.queryInput.blur();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.renderer.keyInput.off("keypress", this.onKeyPress);
    this.renderer.off(CliRenderEvents.RESIZE, this.onResize);
    this.queryInput.off(InputRenderableEvents.INPUT, this.onInput);
    this.container.parent?.remove(this.container);
    this.container.destroyRecursively();
  }

  private setFilter(filter: TreeFilter): void {
    this.filter = filter;
    this.relayout();
  }

  private relayout(): void {
    this.layout =
      this.tree === undefined
        ? []
        : layoutTree(this.tree, {
            filter: this.filter,
            query: this.query,
            folded: this.folded,
          });
    const selected = nearestRowIndex(this.layout, this.parents, this.lastSelected ?? null);
    this.list.setRows(this.layout, selected);

    if (this.layout.length > 0) this.lastSelected = this.layout[selected]?.oid ?? null;
    this.scroll.flexBasis = Math.max(1, Math.min(this.layout.length, this.maxVisible));
    this.scroll.visible = this.layout.length > 0;
    this.empty.content = this.loading ? "Loading…" : "No entries found";
    this.empty.visible = this.layout.length === 0;
    this.scroll.scrollTo(0);
    this.scrollIntoView(selected);
    this.paintFooter();
    this.onRows(this.rows);
  }

  /** `(selected/total) [filter]`, the way pi's footer reads. */
  private paintFooter(): void {
    const total = this.layout.length;
    const position = total === 0 ? 0 : this.list.getSelectedIndex() + 1;
    const mode = this.filter === "default" ? "" : ` [${this.filter}]`;
    this.footer.content = new StyledText([
      fg(this.theme.dim)(`  (${String(position)}/${String(total)})${mode}`),
    ]);
  }

  /** Scroll the least that brings the selection into the window. */
  private scrollIntoView(index: number): void {
    const top = this.scroll.scrollTop;

    if (index < top) this.scroll.scrollTo(index);
    else if (index >= top + this.maxVisible) this.scroll.scrollTo(index - this.maxVisible + 1);
  }

  private resizeList(): void {
    this.maxVisible = Math.max(1, Math.min(MAX_ROWS, this.panel.body.height - BODY_CHROME_ROWS));
    this.scroll.flexBasis = Math.max(1, Math.min(this.layout.length, this.maxVisible));
    this.scrollIntoView(this.list.getSelectedIndex());
  }

  private onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    const index = this.list.indexAt(event.y);

    if (index === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    this.list.setSelectedIndex(index);
    const oid = this.selectedOid;

    if (oid !== undefined) this.onSelect(oid);
  }

  private readonly onResize = (): void => {
    this.resizeList();
    this.list.setHovered(undefined);
    this.scroll.flexBasis = Math.max(1, Math.min(this.layout.length, this.maxVisible));
    this.scroll.scrollTo(0);
    this.scrollIntoView(this.list.getSelectedIndex());
    this.onRows(this.rows);
  };

  private readonly onInput = (value: string): void => {
    if (!this.filtering) return;
    this.query = value;
    // A search shows everything it matches; folds would hide matches.
    this.folded.clear();
    this.relayout();
  };

  private setQuery(value: string): void {
    this.filtering = false;
    this.queryInput.value = value;
    this.filtering = true;
    this.query = value;
  }

  /** Fold the selected branch, or jump to the row that starts the branch it is in. */
  private foldOrUp(): void {
    const index = this.list.getSelectedIndex();
    const row = this.layout[index];

    if (row === undefined) return;

    if (row.foldable && !row.folded) {
      this.folded.add(row.oid);
      this.relayout();

      return;
    }

    const start = this.layout.findLast(
      (candidate, position) => position < index && candidate.connector,
    );

    this.list.setSelectedIndex(start === undefined ? 0 : this.layout.indexOf(start));
  }

  /** Unfold the selected branch, or jump to the next branch start below. */
  private unfoldOrDown(): void {
    const index = this.list.getSelectedIndex();
    const row = this.layout[index];

    if (row === undefined) return;

    if (row.folded) {
      this.folded.delete(row.oid);
      this.relayout();

      return;
    }

    const next = this.layout.findIndex(
      (candidate, position) => position > index && candidate.connector,
    );

    if (next !== -1) this.list.setSelectedIndex(next);
  }

  private cycleFilter(step: 1 | -1): void {
    const at = FILTER_CYCLE.indexOf(this.filter);
    const next = FILTER_CYCLE[(at + step + FILTER_CYCLE.length) % FILTER_CYCLE.length];

    if (next !== undefined) this.setFilter(next);
  }

  private toggleFilter(filter: TreeFilter): void {
    this.setFilter(this.filter === filter ? "default" : filter);
  }

  private copySelected(): void {
    const row = this.layout[this.list.getSelectedIndex()];

    if (row === undefined) return;
    const text = row.text === "" ? row.label : row.text;
    this.renderer.copyToClipboardOSC52(text);
  }

  private readonly onKeyPress = (key: KeyEvent): void => {
    if (this.destroyed || key.defaultPrevented) return;

    if (matchesKey("tree.close", key, "required")) {
      consume(key);

      if (this.query === "") this.onCancel();
      else {
        this.setQuery("");
        this.relayout();
      }

      return;
    }

    if (key.ctrl) {
      switch (true) {
        case matchesKey("tree.filter.default", { name: key.name, ctrl: key.ctrl }):
          this.setFilter("default");
          break;
        case matchesKey("tree.filter.tools", { name: key.name, ctrl: key.ctrl }):
          this.toggleFilter("no-tools");
          break;
        case matchesKey("tree.filter.users", { name: key.name, ctrl: key.ctrl }):
          this.toggleFilter("users");
          break;
        case matchesKey("tree.filter.all", { name: key.name, ctrl: key.ctrl }):
          this.toggleFilter("all");
          break;
        case matchesKey("tree.filter.previous", {
          name: key.name,
          ctrl: key.ctrl,
          shift: key.shift,
        }):
          this.cycleFilter(-1);
          break;
        case matchesKey("tree.filter.next", { name: key.name, ctrl: key.ctrl }):
          this.cycleFilter(1);
          break;
        case matchesKey("tree.copy", { name: key.name, ctrl: key.ctrl }):
          this.copySelected();
          break;
        case matchesKey("picker.previous", { name: key.name, ctrl: key.ctrl }):
          this.list.moveBy(-1);
          break;
        case matchesKey("picker.next", { name: key.name, ctrl: key.ctrl }):
          this.list.moveBy(1);
          break;
        default:
          return;
      }

      consume(key);

      return;
    }

    if (this.layout.length === 0) return;

    if (matchesKeyName("picker.accept", key)) {
      consume(key);
      const oid = this.selectedOid;

      if (oid !== undefined) this.onSelect(oid);

      return;
    }

    const page = Math.max(1, this.maxVisible);

    if (matchesKey("picker.previous", key, "required")) {
      this.list.moveBy(-1);
    } else if (matchesKey("picker.next", key, "required")) {
      this.list.moveBy(1);
    } else if (matchesKey("tree.fold", { name: key.name, meta: key.meta || key.option })) {
      this.foldOrUp();
    } else if (matchesKey("tree.unfold", { name: key.name, meta: key.meta || key.option })) {
      this.unfoldOrDown();
    } else if (matchesKeyName("tree.page.up", key)) {
      this.list.setSelectedIndex(Math.max(0, this.list.getSelectedIndex() - page));
    } else if (matchesKeyName("tree.page.down", key)) {
      this.list.setSelectedIndex(
        Math.min(this.layout.length - 1, this.list.getSelectedIndex() + page),
      );
    } else {
      return;
    }

    consume(key);
  };
}
