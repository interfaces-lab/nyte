import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { MAX_PANES, reduceLayout } from "./layout.ts";
import type {
  Layout,
  LayoutAction,
  LayoutNode,
  LayoutRules,
  Pane,
  PaneSize,
  PaneTab,
} from "./layout.ts";

interface Note {
  readonly kind: "note" | "chat";
  readonly text: string;
}

type Node = LayoutNode<Note>;

function rules(): LayoutRules<Note> {
  let next = 0;

  return {
    identify: (content) => (content.kind === "chat" ? undefined : content.text),
    newId: () => `id${String((next += 1))}`,
  };
}

function tab(text: string, kind: Note["kind"] = "note"): PaneTab<Note> {
  return { id: asId<"pane-tab">(text), content: { kind, text } };
}

function pane(id: string, shown: PaneTab<Note>): Pane<Note> {
  return { kind: "pane", id: asId<"pane">(id), tab: shown };
}

function row(...children: readonly (readonly [Node, number])[]): Node {
  const sized = children.map((entry) => ({ node: entry[0], size: share(entry[1]) }));
  const first = sized[0];
  const second = sized[1];

  if (first === undefined || second === undefined) throw new Error("A row needs two children.");

  return {
    kind: "split",
    id: asId<"split">("row"),
    direction: "right",
    children: [first, second, ...sized.slice(2)],
  };
}

function share(value: number): PaneSize {
  return value;
}

function layout(root: Node, focus: readonly [string, ...string[]]): Layout<Note> {
  return {
    root,
    focus: [asId<"pane">(focus[0]), ...focus.slice(1).map((id) => asId<"pane">(id))],
  };
}

function describe(state: Layout<Note>): string {
  const node = (entry: Node): string => {
    if (entry.kind === "pane") return `${entry.id}[${entry.tab.content.text}]`;

    const children = entry.children.map(
      (child) =>
        `${node(child.node)} ${typeof child.size === "number" ? String(Number(child.size.toFixed(4))) : `${String(child.size.px)}px`}`,
    );

    return `${entry.direction}(${children.join(", ")})`;
  };

  return `${node(state.root)} focus ${state.focus.join(",")}`;
}

const ONE = tab("one");

const THREE = tab("three");

const START = layout(row([pane("A", ONE), 1], [pane("B", THREE), 1]), ["A", "B"]);

const id = (value: string) => asId<"pane-tab">(value);

const paneId = (value: string) => asId<"pane">(value);

test.each<{
  readonly name: string;
  readonly start?: Layout<Note>;
  readonly action: LayoutAction<Note>;
  readonly expected: string;
  readonly kept: readonly PaneTab<Note>[];
}>([
  {
    name: "focusing a pane keeps the tree",
    action: { kind: "focus", pane: paneId("B") },
    expected: "right(A[one] 1, B[three] 1) focus B,A",
    kept: [ONE, THREE],
  },
  {
    name: "resizing a split keeps every pane",
    action: { kind: "resize", split: asId<"split">("row"), sizes: [share(2), share(1)] },
    expected: "right(A[one] 2, B[three] 1) focus A,B",
    kept: [ONE, THREE],
  },
  {
    name: "activating a tab focuses its pane",
    action: { kind: "activate", tab: id("three") },
    expected: "right(A[one] 1, B[three] 1) focus B,A",
    kept: [ONE, THREE],
  },
  {
    name: "opening into the focused pane replaces its tab",
    action: {
      kind: "open",
      content: { kind: "note", text: "four" },
      place: { kind: "focused" },
    },
    expected: "right(A[four] 1, B[three] 1) focus A,B",
    kept: [THREE],
  },
  {
    name: "opening what is already open shows that tab",
    action: {
      kind: "open",
      content: { kind: "note", text: "three" },
      place: { kind: "focused" },
    },
    expected: "right(A[one] 1, B[three] 1) focus B,A",
    kept: [ONE, THREE],
  },
  {
    name: "opening at a pane's edge in the same row halves that pane",
    action: {
      kind: "open",
      content: { kind: "note", text: "four" },
      place: { kind: "edge", pane: paneId("B"), direction: "right", side: "after" },
    },
    expected: "right(A[one] 1, B[three] 0.5, id2[four] 0.5) focus id2,A,B",
    kept: [ONE, THREE],
  },
  {
    name: "moving a tab to a pane's edge across the split nests a new split",
    start: layout(row([pane("A", ONE), 1], [pane("B", THREE), 1], [pane("C", tab("two")), 1]), [
      "A",
      "B",
      "C",
    ]),
    action: {
      kind: "move",
      tab: id("one"),
      place: { kind: "edge", pane: paneId("B"), direction: "down", side: "after" },
    },
    expected: "right(down(B[three] 1, id1[one] 1) 1, C[two] 1) focus id1,B,C",
    kept: [ONE, THREE],
  },
  {
    name: "closing a pane's tab gives the row to its sibling",
    action: { kind: "close", tab: id("three") },
    expected: "A[one] focus A",
    kept: [ONE],
  },
  {
    name: "changing one tab's content leaves the others",
    action: { kind: "set-content", tab: id("one"), content: { kind: "note", text: "uno" } },
    expected: "right(A[uno] 1, B[three] 1) focus A,B",
    kept: [THREE],
  },
])("$name", (row) => {
  const start = row.start ?? START;
  const next = reduceLayout(start, row.action, rules());
  const tabs = allTabs(next.root);

  expect(describe(next)).toBe(row.expected);

  for (const kept of row.kept) expect(tabs.find((entry) => entry.id === kept.id)).toBe(kept);
});

test.each<{
  readonly name: string;
  readonly start: Layout<Note>;
  readonly action: LayoutAction<Note>;
  readonly expected: string;
}>([
  {
    name: "the last tab of the last pane stays",
    start: layout(pane("A", ONE), ["A"]),
    action: { kind: "close", tab: id("one") },
    expected: "A[one] focus A",
  },
  {
    name: "removing a pane merges a split that runs the same way into its parent",
    start: layout(
      row(
        [pane("A", ONE), 1],
        [
          {
            kind: "split",
            id: asId<"split">("column"),
            direction: "down",
            children: [
              { node: row([pane("B", tab("two")), 1], [pane("C", THREE), 3]), size: share(1) },
              { node: pane("D", tab("four")), size: share(1) },
            ],
          },
          2,
        ],
      ),
      ["A"],
    ),
    action: { kind: "close", tab: id("four") },
    expected: "right(A[one] 1, B[two] 0.5, C[three] 1.5) focus A,B,C",
  },
])("$name", (row) => {
  expect(describe(reduceLayout(row.start, row.action, rules()))).toBe(row.expected);
});

test("a new pane past the limit is refused and the layout stays as it was", () => {
  const panes = Array.from({ length: MAX_PANES }, (_, index): readonly [Node, number] => [
    pane(`P${String(index)}`, tab(`t${String(index)}`)),
    1,
  ]);

  const start = layout(row(...panes), ["P0"]);

  expect(
    reduceLayout(
      start,
      {
        kind: "open",
        content: { kind: "note", text: "x" },
        place: { kind: "edge", pane: paneId("P0"), direction: "right", side: "after" },
      },
      rules(),
    ),
  ).toBe(start);
});

test("an action that changes nothing returns the same layout", () => {
  expect(reduceLayout(START, { kind: "focus", pane: paneId("A") }, rules())).toBe(START);
  expect(reduceLayout(START, { kind: "activate", tab: id("one") }, rules())).toBe(START);
  expect(
    reduceLayout(
      START,
      {
        kind: "move",
        tab: id("one"),
        place: { kind: "edge", pane: paneId("A"), direction: "right", side: "after" },
      },
      rules(),
    ),
  ).toBe(START);
  expect(
    reduceLayout(
      START,
      { kind: "resize", split: asId<"split">("row"), sizes: [share(1), share(1)] },
      rules(),
    ),
  ).toBe(START);
});

function allTabs(node: Node): readonly PaneTab<Note>[] {
  return node.kind === "pane" ? [node.tab] : node.children.flatMap((child) => allTabs(child.node));
}
