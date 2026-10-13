/**
 * Session tree state: the forest build, `describe`, `passes`,
 * `visibleForest`, `layoutTree`, `nearestRowIndex`; folds, filters and
 * search are fields here.
 */
import type { CommitId, HeadName, TreeNode, TreeView } from "@nyte-ai/sdk";
import type { DialogCommand, DialogId, DialogStep } from "./dialog.ts";
import { matchesTerms } from "./list.ts";

export type TreeFilter = "default" | "no-tools" | "users" | "all";

export interface TreeDialog {
  readonly kind: "tree";
  readonly id: DialogId;
  readonly tree:
    | { readonly kind: "loading" }
    | { readonly kind: "ready"; readonly load: TreeLoad }
    | { readonly kind: "failed"; readonly message: string };
  readonly filter: TreeFilter;
  readonly query: string;
  readonly folded: ReadonlySet<CommitId>;
  /** The commit the cursor is on; null opens on the tip. A filtered-out pick falls back to its nearest visible ancestor. */
  readonly selected: CommitId | null;
  /** Whether the composer was empty when the tree opened: landing on a user message needs it empty. */
  readonly composerEmpty: boolean;
}

export interface TreeLoad {
  readonly view: TreeView;
  readonly tip: CommitId | null;
}

export type TreeRole = "user" | "assistant" | "tool" | "checkpoint" | "summary";

/** One drawn row of the tree. */
export interface TreeRow {
  readonly oid: CommitId;
  readonly node: TreeNode;
  /** Gutters, connectors and the fold glyph, three cells per level. */
  readonly prefix: string;
  /** The first row of a branch. */
  readonly connector: boolean;
  readonly foldable: boolean;
  readonly folded: boolean;
  readonly active: boolean;
  /** Other heads whose tip is this commit. */
  readonly heads: readonly HeadName[];
  readonly role: TreeRole;
  readonly label: string;
  readonly text: string;
}

const FILTER_CYCLE: readonly TreeFilter[] = ["default", "no-tools", "users", "all"];

const MAX_TEXT_CHARS = 200;

const PAGE = 10;

interface TreeItem {
  readonly node: TreeNode;
  readonly children: TreeItem[];
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

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim().slice(0, MAX_TEXT_CHARS);
}

function describe(node: TreeNode): Described {
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

function passes(node: TreeNode, filter: TreeFilter, tip: CommitId | null): boolean {
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

function forest(view: TreeView): readonly TreeItem[] {
  const items = new Map<CommitId, TreeItem>();
  const roots: TreeItem[] = [];

  for (const node of view.nodes) {
    const item: TreeItem = { node, children: [] };
    items.set(node.id, item);
    const parent = node.parent === null ? undefined : items.get(node.parent);

    if (parent === undefined) roots.push(item);
    else parent.children.push(item);
  }

  return roots;
}

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

function foldGlyph(foldable: boolean, folded: boolean): string {
  if (!foldable) return "─";

  return folded ? "⊞" : "⊟";
}

interface Gutter {
  readonly position: number;
  readonly show: boolean;
}

/**
 * Flatten with pi's indentation: a branch point indents its children, the
 * first generation after a branch indents once more for grouping, and a
 * single-child chain stays flat. A folded branch row keeps its glyph and
 * drops everything under it.
 */
function layoutTree(
  load: TreeLoad,
  filter: TreeFilter,
  query: string,
  folded: ReadonlySet<CommitId>,
): TreeRow[] {
  const visible = visibleForest(forest(load.view), (item) => {
    const described = describe(item.node);

    return (
      passes(item.node, filter, load.tip) &&
      matchesTerms(query, `${described.label} ${described.text}`)
    );
  });

  const multipleRoots = visible.length > 1;
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
    const described = describe(item.node.node);
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

      if (gutter !== undefined) cells.push(offset === 0 && gutter.show ? "│" : " ");
      else if (connector && level === connectorPosition)
        cells.push(
          offset === 0 ? (isLast ? "└" : "├") : offset === 1 ? foldGlyph(foldable, isFolded) : " ",
        );
      else cells.push(" ");
    }

    rows.push({
      oid: item.node.node.id,
      node: item.node.node,
      prefix: cells.join(""),
      connector,
      foldable,
      folded: isFolded,
      active: item.node.node.active,
      heads: item.node.node.id === load.tip ? [] : item.node.node.heads,
      ...described,
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

    for (const [index, child] of ordered.entries())
      visit(
        child,
        childIndent,
        multiple,
        multiple,
        index === ordered.length - 1,
        childGutters,
        false,
      );
  };

  const orderedRoots = visible.toSorted(
    (left, right) => Number(containsActive(right)) - Number(containsActive(left)),
  );

  for (const [index, root] of orderedRoots.entries())
    visit(
      root,
      multipleRoots ? 1 : 0,
      multipleRoots,
      multipleRoots,
      index === orderedRoots.length - 1,
      [],
      true,
    );

  return rows;
}

/** The rows the tree draws now, for its filter, query and folds. */
export function treeRows(dialog: TreeDialog): readonly TreeRow[] {
  if (dialog.tree.kind !== "ready") return [];

  return layoutTree(dialog.tree.load, dialog.filter, dialog.query, dialog.folded);
}

/** Index of the selected commit, else of its nearest ancestor with a row, else the last row. */
export function selectedIndex(dialog: TreeDialog, rows: readonly TreeRow[]): number {
  if (dialog.tree.kind !== "ready") return 0;
  const parents = new Map(dialog.tree.load.view.nodes.map((node) => [node.id, node.parent]));
  const index = new Map(rows.map((row, position) => [row.oid, position]));
  const seen = new Set<CommitId>();
  let current = dialog.selected ?? dialog.tree.load.tip;

  while (current !== null && !seen.has(current)) {
    seen.add(current);
    const found = index.get(current);

    if (found !== undefined) return found;
    current = parents.get(current) ?? null;
  }

  return Math.max(0, rows.length - 1);
}

/** The tree once loaded: the cursor starts on the tip. */
export function withTree(dialog: TreeDialog, load: TreeLoad): TreeDialog {
  return { ...dialog, tree: { kind: "ready", load }, selected: dialog.selected ?? load.tip };
}

function unchanged(dialog: TreeDialog): DialogStep<TreeDialog> {
  return { dialog, intents: [], push: null };
}

function select(dialog: TreeDialog, rows: readonly TreeRow[], index: number): TreeDialog {
  const row = rows[Math.max(0, Math.min(rows.length - 1, index))];

  return row === undefined ? dialog : { ...dialog, selected: row.oid };
}

function isDescendantOfTip(load: TreeLoad, picked: CommitId): boolean {
  if (load.tip === null) return true;
  const parents = new Map(load.view.nodes.map((node) => [node.id, node.parent]));
  const seen = new Set<CommitId>();
  let ancestor: CommitId | null = picked;

  while (ancestor !== null && ancestor !== load.tip && !seen.has(ancestor)) {
    seen.add(ancestor);
    ancestor = parents.get(ancestor) ?? null;
  }

  return ancestor === load.tip;
}

function accept(dialog: TreeDialog, row: TreeRow | undefined): DialogStep<TreeDialog> {
  if (dialog.tree.kind !== "ready" || row === undefined) return unchanged(dialog);
  const { load } = dialog.tree;

  if (row.oid === load.tip)
    return {
      dialog,
      intents: [{ kind: "refuse", reason: "Already at that point in the chat", tone: "info" }],
      push: null,
    };

  if (row.node.kind === "user" && !dialog.composerEmpty)
    return {
      dialog,
      intents: [{ kind: "refuse", reason: "Clear the composer before editing a message" }],
      push: null,
    };

  const expect = load.view.revision ?? undefined;

  if (isDescendantOfTip(load, row.oid))
    return {
      dialog: null,
      intents: [
        {
          kind: "move-to",
          commit: row.oid,
          abandoned: "keep",
          expect,
        },
      ],
      push: null,
    };

  return {
    dialog: { ...dialog, selected: row.oid },
    intents: [],
    push: {
      kind: "list",
      id: `${dialog.id}:summary`,
      purpose: { kind: "summary", target: row.oid, revision: load.view.revision, typed: true },
      title: "Summarize the branch you are leaving?",
      choices: {
        kind: "ready",
        items: [
          {
            id: "none",
            label: "No summary",
            description: "Leave the branch as it is",
            status: null,
            mark: null,
          },
          {
            id: "summarize",
            label: "Summarize",
            description: "Keep what the branch was about",
            status: null,
            mark: null,
          },
        ],
      },
      query: "",
      highlighted: 0,
      answering: "",
      busy: false,
    },
  };
}

function toggleFilter(dialog: TreeDialog, filter: TreeFilter): TreeDialog {
  return { ...dialog, filter: dialog.filter === filter ? "default" : filter };
}

function cycleFilter(dialog: TreeDialog, step: 1 | -1): TreeDialog {
  const at = FILTER_CYCLE.indexOf(dialog.filter);

  return {
    ...dialog,
    filter: FILTER_CYCLE[(at + step + FILTER_CYCLE.length) % FILTER_CYCLE.length] ?? "default",
  };
}

/**
 * Enter on a row:
 * - the tip → refuse "Already at that point in the chat"
 * - a user message with a non-empty composer → refuse "Clear the composer before editing a message"
 * - a descendant of the tip → intent move-to(commit, keep)
 * - otherwise → push the summary list (none | summarize | custom); its accept emits move-to
 * Ctrl+X copies the row text (intent copy-text).
 */
export function reduceTree(dialog: TreeDialog, command: DialogCommand): DialogStep<TreeDialog> {
  if (command.kind === "close") return { dialog: null, intents: [], push: null };

  if (command.kind === "query")
    return unchanged({ ...dialog, query: command.text, folded: new Set() });
  const rows = treeRows(dialog);
  const index = selectedIndex(dialog, rows);

  if (command.kind === "pick")
    return accept(select(dialog, rows, command.index), rows[command.index]);
  const row = rows[index];

  switch (command.name) {
    case "tree.close":
    case "picker.close":
      return dialog.query === ""
        ? { dialog: null, intents: [], push: null }
        : unchanged({ ...dialog, query: "" });
    case "picker.accept":
      return accept(dialog, row);
    case "picker.previous":
      return unchanged(
        select(dialog, rows, rows.length === 0 ? 0 : (index - 1 + rows.length) % rows.length),
      );
    case "picker.next":
      return unchanged(select(dialog, rows, rows.length === 0 ? 0 : (index + 1) % rows.length));
    case "tree.page.up":
    case "picker.page.up":
      return unchanged(select(dialog, rows, index - PAGE));
    case "tree.page.down":
    case "picker.page.down":
      return unchanged(select(dialog, rows, index + PAGE));
    case "tree.filter.default":
      return unchanged({ ...dialog, filter: "default" });
    case "tree.filter.tools":
      return unchanged(toggleFilter(dialog, "no-tools"));
    case "tree.filter.users":
      return unchanged(toggleFilter(dialog, "users"));
    case "tree.filter.all":
      return unchanged(toggleFilter(dialog, "all"));
    case "tree.filter.next":
      return unchanged(cycleFilter(dialog, 1));
    case "tree.filter.previous":
      return unchanged(cycleFilter(dialog, -1));
    case "tree.fold": {
      if (row === undefined) return unchanged(dialog);

      if (row.foldable && !row.folded)
        return unchanged({ ...dialog, folded: new Set([...dialog.folded, row.oid]) });

      const start = rows.findLastIndex(
        (candidate, position) => position < index && candidate.connector,
      );

      return unchanged(select(dialog, rows, Math.max(0, start)));
    }

    case "tree.unfold": {
      if (row === undefined) return unchanged(dialog);

      if (row.folded)
        return unchanged({
          ...dialog,
          folded: new Set([...dialog.folded].filter((oid) => oid !== row.oid)),
        });
      const next = rows.findIndex((candidate, position) => position > index && candidate.connector);

      return next === -1 ? unchanged(dialog) : unchanged(select(dialog, rows, next));
    }

    case "tree.copy":
      return row === undefined
        ? unchanged(dialog)
        : {
            dialog,
            intents: [{ kind: "copy-text", text: row.text === "" ? row.label : row.text }],
            push: null,
          };
    default:
      return unchanged(dialog);
  }
}
