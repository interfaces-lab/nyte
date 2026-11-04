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
  readonly kind: "note" | "preview" | "chat";
  readonly text: string;
}

type Node = LayoutNode<Note>;

function rules(): LayoutRules<Note> {
  let next = 0;

  return {
    identify: (content) => (content.kind === "chat" ? undefined : content.text),
    replaceable: (content) => content.kind === "preview",
    newId: () => `id${String((next += 1))}`,
  };
}

function tab(text: string, kind: Note["kind"] = "note"): PaneTab<Note> {
  return { id: asId<"pane-tab">(text), content: { kind, text } };
}

function pane(
  id: string,
  tabs: readonly [PaneTab<Note>, ...PaneTab<Note>[]],
  hidden = false,
): Pane<Note> {
  return { kind: "pane", id: asId<"pane">(id), tabs, active: tabs[0].id, hidden };
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
  return { kind: "share", share: value };
}

function layout(
  root: Node,
  focus: readonly [string, ...string[]],
  zoomed: string | null = null,
): Layout<Note> {
  return {
    root,
    focus: [asId<"pane">(focus[0]), ...focus.slice(1).map((id) => asId<"pane">(id))],
    zoomed: zoomed === null ? null : asId<"pane">(zoomed),
  };
}

/** `right(A[one*,two] 1, ~B[three*] 200px) focus A,B zoom A`: `*` marks the active tab, `~` a hidden pane. */
function describe(state: Layout<Note>): string {
  const node = (entry: Node): string => {
    if (entry.kind === "pane") {
      const tabs = entry.tabs.map(
        (item) => `${item.content.text}${item.id === entry.active ? "*" : ""}`,
      );

      return `${entry.hidden ? "~" : ""}${entry.id}[${tabs.join(",")}]`;
    }

    const children = entry.children.map(
      (child) =>
        `${node(child.node)} ${child.size.kind === "share" ? String(Number(child.size.share.toFixed(4))) : `${String(child.size.pixels)}px`}`,
    );

    return `${entry.direction}(${children.join(", ")})`;
  };

  return `${node(state.root)} focus ${state.focus.join(",")}${state.zoomed === null ? "" : ` zoom ${state.zoomed}`}`;
}

const ONE = tab("one");

const TWO = tab("two");

const THREE = tab("three");

const START = layout(row([pane("A", [ONE, TWO]), 1], [pane("B", [THREE]), 1]), ["A", "B"]);

const id = (value: string) => asId<"pane-tab">(value);

const paneId = (value: string) => asId<"pane">(value);

test.each<{
  readonly name: string;
  readonly start?: Layout<Note>;
  readonly action: LayoutAction<Note>;
  readonly expected: string;
  /** Tabs whose objects must survive the action unchanged, so their content doesn't render again. */
  readonly kept: readonly PaneTab<Note>[];
}>([
  {
    name: "focusing a pane keeps the tree",
    action: { kind: "focus", pane: paneId("B") },
    expected: "right(A[one*,two] 1, B[three*] 1) focus B,A",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "zooming a pane keeps the tree and focuses it",
    action: { kind: "zoom", pane: paneId("B") },
    expected: "right(A[one*,two] 1, B[three*] 1) focus B,A zoom B",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "resizing a split keeps every pane",
    action: { kind: "resize", split: asId<"split">("row"), sizes: [share(2), share(1)] },
    expected: "right(A[one*,two] 2, B[three*] 1) focus A,B",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "activating a tab focuses its pane",
    action: { kind: "activate", tab: id("two") },
    expected: "right(A[one,two*] 1, B[three*] 1) focus A,B",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "opening goes after the focused pane's active tab",
    action: {
      kind: "open",
      content: { kind: "note", text: "four" },
      place: { kind: "focused" },
      activate: true,
    },
    expected: "right(A[one,four*,two] 1, B[three*] 1) focus A,B",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "opening what is already open shows that tab",
    action: {
      kind: "open",
      content: { kind: "note", text: "three" },
      place: { kind: "focused" },
      activate: true,
    },
    expected: "right(A[one*,two] 1, B[three*] 1) focus B,A",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "moving a pane's last tab into another pane closes the emptied pane",
    action: {
      kind: "move",
      tab: id("three"),
      place: { kind: "pane", pane: paneId("A"), index: 0 },
    },
    expected: "A[three*,one,two] focus A",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "moving a tab to a pane's edge across the split nests a new split",
    action: {
      kind: "move",
      tab: id("one"),
      place: { kind: "edge", pane: paneId("B"), direction: "down", side: "after" },
    },
    expected: "right(A[two*] 1, down(B[three*] 1, id1[one*] 1) 1) focus id1,A,B",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "splitting moves the active tab into a new pane beside it in the same row",
    action: { kind: "split", pane: paneId("A"), direction: "right" },
    expected: "right(A[two*] 0.5, id1[one*] 0.5, B[three*] 1) focus id1,A,B",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "closing a pane's last tab gives the row to its sibling",
    action: { kind: "close", tab: id("three") },
    expected: "A[one*,two] focus A",
    kept: [ONE, TWO],
  },
  {
    name: "closing the active tab activates its neighbour",
    action: { kind: "close", tab: id("one") },
    expected: "right(A[two*] 1, B[three*] 1) focus A,B",
    kept: [TWO, THREE],
  },
  {
    name: "hiding a pane keeps its size and moves focus to one in view",
    start: layout(row([pane("A", [ONE, TWO]), 1], [pane("B", [THREE]), 1]), ["B", "A"]),
    action: { kind: "toggle-hidden", pane: paneId("B") },
    expected: "right(A[one*,two] 1, ~B[three*] 1) focus A,B",
    kept: [ONE, TWO, THREE],
  },
  {
    name: "changing one tab's content leaves the others",
    action: { kind: "set-content", tab: id("one"), content: { kind: "note", text: "uno" } },
    expected: "right(A[uno*,two] 1, B[three*] 1) focus A,B",
    kept: [TWO, THREE],
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
    name: "a preview gives way to the next preview opened in its pane",
    start: layout(pane("A", [ONE, tab("draft", "preview")]), ["A"]),
    action: {
      kind: "open",
      content: { kind: "preview", text: "sketch" },
      place: { kind: "focused" },
      activate: true,
    },
    expected: "A[one,sketch*] focus A",
  },
  {
    name: "a tab for a kind goes to the latest pane holding that kind",
    start: layout(row([pane("A", [tab("chat", "chat")]), 1], [pane("B", [THREE]), 1]), ["A", "B"]),
    action: {
      kind: "open",
      content: { kind: "note", text: "four" },
      place: { kind: "for", tabKind: "note" },
      activate: true,
    },
    expected: "right(A[chat*] 1, B[three,four*] 1) focus B,A",
  },
  {
    name: "a tab for a kind no pane holds opens beside the focused pane",
    start: layout(pane("A", [tab("chat", "chat")]), ["A"]),
    action: {
      kind: "open",
      content: { kind: "note", text: "four" },
      place: { kind: "for", tabKind: "note" },
      activate: true,
    },
    expected: "right(A[chat*] 1, id2[four*] 1) focus id2,A",
  },
  {
    name: "the last tab of the last pane stays",
    start: layout(pane("A", [ONE]), ["A"]),
    action: { kind: "close", tab: id("one") },
    expected: "A[one*] focus A",
  },
  {
    name: "a pane with one tab has nothing to split off",
    start: layout(pane("A", [ONE]), ["A"]),
    action: { kind: "split", pane: paneId("A"), direction: "right" },
    expected: "A[one*] focus A",
  },
  {
    name: "the only pane in view stays in view",
    start: layout(row([pane("A", [ONE]), 1], [pane("B", [THREE], true), 1]), ["A", "B"]),
    action: { kind: "toggle-hidden", pane: paneId("A") },
    expected: "right(A[one*] 1, ~B[three*] 1) focus A,B",
  },
  {
    name: "activating a tab in a hidden pane shows the pane",
    start: layout(row([pane("A", [ONE]), 1], [pane("B", [THREE], true), 1]), ["A", "B"]),
    action: { kind: "activate", tab: id("three") },
    expected: "right(A[one*] 1, B[three*] 1) focus B,A",
  },
  {
    name: "closing the zoomed pane ends the zoom",
    start: layout(row([pane("A", [ONE]), 1], [pane("B", [THREE]), 1]), ["B", "A"], "B"),
    action: { kind: "close", tab: id("three") },
    expected: "A[one*] focus A",
  },
  {
    name: "removing a pane merges a split that runs the same way into its parent",
    start: layout(
      row(
        [pane("A", [ONE]), 1],
        [
          {
            kind: "split",
            id: asId<"split">("column"),
            direction: "down",
            children: [
              { node: row([pane("B", [TWO]), 1], [pane("C", [THREE]), 3]), size: share(1) },
              { node: pane("D", [tab("four")]), size: share(1) },
            ],
          },
          2,
        ],
      ),
      ["A"],
    ),
    action: { kind: "close", tab: id("four") },
    expected: "right(A[one*] 1, B[two*] 0.5, C[three*] 1.5) focus A,B,C",
  },
])("$name", (row) => {
  expect(describe(reduceLayout(row.start, row.action, rules()))).toBe(row.expected);
});

test("a new pane past the limit is refused and the layout stays as it was", () => {
  const tabs = Array.from({ length: MAX_PANES }, (_, index) => tab(`t${String(index)}`));

  const panes = tabs.map((entry, index): readonly [Node, number] => [
    pane(`P${String(index)}`, [entry, tab(`x${String(index)}`)]),
    1,
  ]);

  const start = layout(row(...panes), ["P0"]);

  expect(
    reduceLayout(start, { kind: "split", pane: paneId("P0"), direction: "right" }, rules()),
  ).toBe(start);
});

test("an action that changes nothing returns the same layout", () => {
  expect(reduceLayout(START, { kind: "focus", pane: paneId("A") }, rules())).toBe(START);
  expect(reduceLayout(START, { kind: "activate", tab: id("one") }, rules())).toBe(START);
  expect(reduceLayout(START, { kind: "zoom", pane: null }, rules())).toBe(START);
  expect(
    reduceLayout(
      START,
      { kind: "resize", split: asId<"split">("row"), sizes: [share(1), share(1)] },
      rules(),
    ),
  ).toBe(START);
});

function allTabs(node: Node): readonly PaneTab<Note>[] {
  return node.kind === "pane" ? node.tabs : node.children.flatMap((child) => allTabs(child.node));
}
