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

/** Notes keep their text; scratch tabs are never saved; any other kind is one this build doesn't know. */
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
      ? `${entry.hidden ? "~" : ""}${entry.id}[${entry.tabs.map((tab) => `${tab.content.text}${tab.id === entry.active ? "*" : ""}`).join(",")}]`
      : `${entry.direction}(${entry.children.map((child) => `${node(child.node)} ${child.size.kind === "share" ? String(child.size.share) : `${String(child.size.pixels)}px`}`).join(", ")})`;

  return `${node(state.root)} focus ${state.focus.join(",")}${state.zoomed === null ? "" : ` zoom ${state.zoomed}`}`;
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
  children: children.map((node) => ({ node, size: { kind: "share", share: 1 } })),
});

test.each<{ readonly name: string; readonly stored: StoredLayout; readonly expected: string }>([
  {
    name: "a saved layout comes back as it was",
    stored: {
      root: row(
        pane("A", [note("a1", "one"), note("a2", "two")], "a2"),
        pane("E", [note("e1", "tree")], "e1", true),
      ),
      focus: ["A", "E"],
      zoomed: "A",
    },
    expected: "right(A[one,two*] 1, ~E[tree*] 1) focus A,E zoom A",
  },
  {
    name: "a tab of a kind this build doesn't know drops alone",
    stored: {
      root: pane("A", [note("a1", "one"), note("a2", "x", "canvas-v9")]),
      focus: ["A"],
      zoomed: null,
    },
    expected: "A[one*] focus A",
  },
  {
    name: "a tab whose fields its kind rejects drops alone",
    stored: {
      root: pane("A", [note("a1", "one", "note", { text: 4 }), note("a2", "two")]),
      focus: ["A"],
      zoomed: null,
    },
    expected: "A[two*] focus A",
  },
  {
    name: "a pane left with no tabs drops, and its split gives way to the sibling",
    stored: {
      root: row(pane("A", [note("a1", "one")]), pane("B", [note("b1", "x", "gone")])),
      focus: ["B", "A"],
      zoomed: "B",
    },
    expected: "A[one*] focus A",
  },
  {
    name: "an active tab that dropped hands over to the pane's first tab",
    stored: {
      root: pane("A", [note("a1", "one"), note("a2", "x", "gone")], "a2"),
      focus: ["A"],
      zoomed: null,
    },
    expected: "A[one*] focus A",
  },
  {
    name: "a pane the focus list forgot joins it last",
    stored: {
      root: row(pane("A", [note("a1", "one")]), pane("B", [note("b1", "two")])),
      focus: ["B"],
      zoomed: null,
    },
    expected: "right(A[one*] 1, B[two*] 1) focus B,A",
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

test("a tab its kind doesn't save is left out, and a pane with nothing saved drops on restore", () => {
  const tab = (id: string, kind: Note["kind"], text: string) => ({
    id: asId<"pane-tab">(id),
    content: { kind, text },
  });

  const one = tab("a1", "note", "one");
  const draft = tab("b1", "scratch", "draft");

  const layout: Layout<Note> = {
    root: {
      kind: "split",
      id: asId<"split">("row"),
      direction: "right",
      children: [
        {
          node: {
            kind: "pane",
            id: asId<"pane">("A"),
            tabs: [one, tab("a2", "scratch", "x")],
            active: one.id,
            hidden: false,
          },
          size: { kind: "share", share: 1 },
        },
        {
          node: {
            kind: "pane",
            id: asId<"pane">("B"),
            tabs: [draft],
            active: draft.id,
            hidden: false,
          },
          size: { kind: "share", share: 1 },
        },
      ],
    },
    focus: [asId<"pane">("B"), asId<"pane">("A")],
    zoomed: null,
  };

  const written: unknown = JSON.parse(JSON.stringify(persistLayout(layout, persist)));

  expect(describe(restoreLayout(Value.Parse(storedLayoutSchema, written), restore))).toBe(
    "A[one*] focus A",
  );
});
