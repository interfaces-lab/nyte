import { expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { TreeNode } from "@nyte-ai/sdk";
import type { TreeDialog } from "../../../src/model/dialogs/tree.ts";
import { key, query, renderDialog, rows } from "./harness.tsx";

function node(
  id: string,
  parent: string | null,
  kind: TreeNode["kind"],
  partKind: string | null,
  preview: string,
  active: boolean,
): TreeNode {
  return {
    id: asId(id),
    parent: parent === null ? null : asId(parent),
    depth: 0,
    branch: false,
    active,
    heads: [],
    kind,
    partKind,
    preview,
    at: 0,
    run: null,
  };
}

const NODES = [
  node("c1", null, "user", null, "hello", true),
  node("c2", "c1", "part", "text", "hi there", true),
  node("c3", "c1", "user", null, "try again", false),
  node("c4", "c3", "part", "tool", "ls", false),
];

const TREE: TreeDialog = {
  kind: "tree",
  id: "t1",
  tree: {
    kind: "ready",
    load: {
      view: { revision: null, tip: { kind: "commit", id: asId("c2") }, nodes: NODES },
      tip: asId("c2"),
    },
  },
  filter: "default",
  query: "",
  folded: new Set(),
  selected: null,
  composerEmpty: true,
};

test("the forest draws with role labels, the active path and the footer at widths 40 and 100", async () => {
  for (const width of [40, 100]) {
    await using app = await renderDialog(TREE, { width });
    const frame = app.frame();

    expect(frame).toContain("Session Tree");
    expect(frame).toContain("• user: hello");
    expect(rows(frame).find((row) => row.includes("❯"))).toContain("• assistant: hi there");
    expect(frame).toContain("user: try again");
    expect(frame).toContain("[tool: ls]");
    expect(frame).toContain("(2/4)");
    expect(frame).toContain("filter");
  }
});

test("the users filter keeps user rows and the tip, and names itself in the footer", async () => {
  await using app = await renderDialog(TREE);
  await app.send(key("tree.filter.users"));
  const frame = app.frame();

  expect(frame).toContain("[users]");
  expect(frame).toContain("assistant: hi there");
  expect(frame).not.toContain("[tool: ls]");
  expect(frame).toContain("(2/3)");
});

test("folding a branch hides its rows and shows the fold glyph", async () => {
  await using app = await renderDialog(TREE);
  await app.send(key("picker.next"));
  expect(app.frame()).toContain("❯");
  expect(app.frame()).toContain("(3/4)");
  await app.send(key("tree.fold"));
  const frame = app.frame();

  expect(frame).not.toContain("[tool: ls]");
  expect(frame).toContain("⊞");
  expect(frame).toContain("(3/3)");
});

test("search keeps the rows whose text matches", async () => {
  await using app = await renderDialog(TREE);
  await app.send(query("again"));
  const frame = app.frame();

  expect(frame).toContain("❯ user: try again");
  expect(frame).not.toContain("hello");
  expect(frame).toContain("(1/1)");
});

test("accepting a row off the tip's path pushes the summary question into the slot", async () => {
  await using app = await renderDialog(TREE);
  await app.send(key("picker.next"));
  await app.send(key("picker.accept"));
  const frame = app.frame();

  expect(frame).toContain("Summarize the branch you are leaving?");
  expect(frame).toContain("❯ No summary");
  expect(frame).toContain("Summarize with custom prompt");
  expect(frame).toContain("esc back");
  expect(frame).not.toContain("Session Tree");
  expect(rows(frame).findIndex((row) => row.includes("esc back"))).toBeLessThan(16);
});

test("loading and empty trees say so", async () => {
  await using loading = await renderDialog({ ...TREE, tree: { kind: "loading" } });

  expect(loading.frame()).toContain("Loading…");

  await using empty = await renderDialog({
    ...TREE,
    tree: {
      kind: "ready",
      load: { view: { revision: null, tip: { kind: "start" }, nodes: [] }, tip: null },
    },
  });

  expect(empty.frame()).toContain("No entries found");
});
