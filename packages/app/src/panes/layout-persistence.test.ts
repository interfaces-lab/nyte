import { asId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";
import type { Layout, LayoutNode } from "./layout.ts";
import { persistLayout, restoreLayout, storedLayoutSchema } from "./layout-persistence.ts";
import type { StoredContent, StoredLayout } from "./layout-persistence.ts";

interface Note {
  readonly kind: "note" | "scratch";
  readonly text: string;
}

const noteFields = Type.Object({ text: Type.String() }, { additionalProperties: false });

function persist(content: Note): StoredContent | undefined {
  return content.kind === "scratch" ? undefined : { kind: "note", fields: { text: content.text } };
}

function restore(stored: StoredContent): Note | undefined {
  return stored.kind === "note" && Value.Check(noteFields, stored.fields)
    ? { kind: "note", text: stored.fields.text }
    : undefined;
}

function describe(state: Layout<Note> | undefined): string {
  if (state === undefined) return "nothing";

  const node = (entry: LayoutNode<Note>): string =>
    entry.kind === "pane"
      ? `${entry.id}[${entry.tab.content.text}]`
      : `${entry.direction}(${entry.children.map((child) => `${node(child.node)} ${typeof child.size === "number" ? String(child.size) : `${String(child.size.px)}px`}`).join(", ")})`;

  return `${node(state.root)} focus ${state.focus.join(",")}`;
}

const note = (id: string, text: string, kind = "note", fields: unknown = { text }) => ({
  id,
  kind,
  fields,
});

const pane = (
  id: string,
  tabs: readonly ReturnType<typeof note>[],
  active = tabs[0]?.id ?? "",
  hidden = false,
) => ({
  kind: "pane",
  id,
  tabs,
  active,
  hidden,
});

const row = (...children: readonly unknown[]) => ({
  kind: "split",
  id: "row",
  direction: "right",
  children: children.map((node) => ({ node, size: 1 })),
});

test.each<{ readonly name: string; readonly stored: StoredLayout; readonly expected: string }>([
  {
    name: "a saved layout comes back with each pane's active tab; hidden and zoomed marks drop",
    stored: {
      root: row(
        pane("A", [note("a1", "one"), note("a2", "two")], "a2"),
        pane("E", [note("e1", "tree")], "e1", true),
      ),
      focus: ["A", "E"],
      zoomed: "A",
    },
    expected: "right(A[two] 1, E[tree] 1) focus A,E",
  },
  {
    name: "a tab of a kind this build doesn't know drops alone",
    stored: {
      root: pane("A", [note("a1", "one"), note("a2", "x", "canvas-v9")]),
      focus: ["A"],
      zoomed: null,
    },
    expected: "A[one] focus A",
  },
  {
    name: "a tab whose fields its kind rejects drops alone",
    stored: {
      root: pane("A", [note("a1", "one", "note", { text: 4 }), note("a2", "two")]),
      focus: ["A"],
      zoomed: null,
    },
    expected: "A[two] focus A",
  },
  {
    name: "a pane left with no tabs drops, and its split gives way to the sibling",
    stored: {
      root: row(pane("A", [note("a1", "one")]), pane("B", [note("b1", "x", "gone")])),
      focus: ["B", "A"],
      zoomed: "B",
    },
    expected: "A[one] focus A",
  },
  {
    name: "an active tab that dropped hands over to the pane's first tab",
    stored: {
      root: pane("A", [note("a1", "one"), note("a2", "x", "gone")], "a2"),
      focus: ["A"],
      zoomed: null,
    },
    expected: "A[one] focus A",
  },
  {
    name: "sizes saved as a share or in pixels come back as a weight or px",
    stored: {
      root: {
        kind: "split",
        id: "row",
        direction: "right",
        children: [
          { node: pane("A", [note("a1", "one")]), size: { kind: "pixels", pixels: 240 } },
          { node: pane("B", [note("b1", "two")]), size: { kind: "share", share: 2 } },
          { node: pane("C", [note("c1", "three")]), size: { px: 300 } },
        ],
      },
      focus: ["A", "B", "C"],
      zoomed: null,
    },
    expected: "right(A[one] 240px, B[two] 2, C[three] 300px) focus A,B,C",
  },
  {
    name: "a pane the focus list forgot joins it last",
    stored: {
      root: row(pane("A", [note("a1", "one")]), pane("B", [note("b1", "two")])),
      focus: ["B"],
      zoomed: null,
    },
    expected: "right(A[one] 1, B[two] 1) focus B,A",
  },
  {
    name: "two panes with one id make the layout corrupt",
    stored: {
      root: row(pane("A", [note("a1", "one")]), pane("A", [note("b1", "two")])),
      focus: ["A"],
      zoomed: null,
    },
    expected: "nothing",
  },
  {
    name: "a root that isn't a node restores nothing",
    stored: { root: { kind: "tabs", tabs: [] }, focus: ["A"], zoomed: null },
    expected: "nothing",
  },
  {
    name: "every tab dropping restores nothing",
    stored: { root: pane("A", [note("a1", "x", "gone")]), focus: ["A"], zoomed: null },
    expected: "nothing",
  },
])("$name", (row) => {
  expect(describe(restoreLayout(row.stored, restore))).toBe(row.expected);
});

test("a pane saves its tab in the stored shape saved windows have, and a pane with nothing saved drops on restore", () => {
  const tab = (id: string, kind: Note["kind"], text: string) => ({
    id: asId<"pane-tab">(id),
    content: { kind, text },
  });

  const layout: Layout<Note> = {
    root: {
      kind: "split",
      id: asId<"split">("row"),
      direction: "right",
      children: [
        { node: { kind: "pane", id: asId<"pane">("A"), tab: tab("a1", "note", "one") }, size: 1 },
        {
          node: { kind: "pane", id: asId<"pane">("B"), tab: tab("b1", "scratch", "draft") },
          size: 1,
        },
      ],
    },
    focus: [asId<"pane">("B"), asId<"pane">("A")],
  };

  const written: unknown = JSON.parse(JSON.stringify(persistLayout(layout, persist)));

  expect(written).toEqual({
    root: row(pane("A", [note("a1", "one")]), { ...pane("B", []), active: "b1" }),
    focus: ["B", "A"],
    zoomed: null,
  });
  expect(describe(restoreLayout(Value.Parse(storedLayoutSchema, written), restore))).toBe(
    "A[one] focus A",
  );
});
