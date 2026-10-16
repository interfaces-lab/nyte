import { asId } from "@nyte-ai/schema";
import type { TreeNode, TreeView } from "@nyte-ai/sdk";
import { describe, expect, test } from "bun:test";
import { treeRows } from "../../src/model/dialogs/tree.ts";
import type { TreeDialog } from "../../src/model/dialogs/tree.ts";
import type { State } from "../../src/model/state.ts";
import { play, ready, S1, typed } from "./support.ts";
import { idle, top, key } from "./dialog-support.ts";

function node(
  id: string,
  parent: string | null,
  kind: TreeNode["kind"],
  preview: string,
  active = true,
): TreeNode {
  return {
    id: asId(id),
    parent: parent === null ? null : asId(parent),
    depth: 0,
    branch: false,
    active,
    heads: [],
    kind,
    partKind: kind === "part" ? "text" : null,
    preview,
    at: 1,
    run: null,
  };
}

const TREE: TreeView = {
  revision: asId("rev-7"),
  tip: { kind: "commit", id: asId("c3") },
  nodes: [
    node("c1", null, "user", "first"),
    node("c2", "c1", "part", "answer"),
    node("c3", "c2", "user", "second"),
    node("c4", "c1", "user", "abandoned branch", false),
  ],
};

function treeState(draft = "", view: TreeView = TREE): State {
  const opened = play(ready(idle), typed(draft), {
    kind: "open",
    dialog: { kind: "tree", filter: "default" },
  });

  const tip = view.tip.kind === "commit" ? view.tip.id : null;

  return play(opened.state, {
    kind: "loaded",
    dialog: "dialog-1",
    data: { kind: "tree", tree: { view, tip } },
  }).state;
}

function treeDialog(state: State): TreeDialog | null {
  const dialog = top(state);

  return dialog?.kind === "tree" ? dialog : null;
}

function selectTree(state: State, commit: string): State {
  const dialog = treeDialog(state);
  const rows = dialog === null ? [] : treeRows(dialog);
  const index = rows.findIndex((row) => row.oid === commit);
  const current = rows.findIndex((row) => row.oid === dialog?.selected);
  const presses = (index - current + rows.length) % rows.length;

  return play(state, ...Array.from({ length: presses }, () => key("picker.next"))).state;
}

describe("tree", () => {
  test("opens on the tip; picking a reply at the tip says so", () => {
    const state = treeState("", { ...TREE, tip: { kind: "commit", id: asId("c2") } });

    expect(treeDialog(state)?.selected).toBe(asId<"commit">("c2"));
    expect(play(state, key("picker.accept")).state.local.notice?.text).toBe(
      "Already at that point in the chat",
    );
  });

  test("picking the user message at the tip moves back to edit it", () => {
    const state = treeState();

    expect(treeDialog(state)?.selected).toBe(asId<"commit">("c3"));
    const moved = play(state, key("picker.accept"));

    expect(moved.state.local.notice?.text).not.toBe("Already at that point in the chat");
    expect(moved.effects).toEqual([
      {
        kind: "move",
        session: S1,
        position: { kind: "commit", id: asId("c3") },
        options: { running: "refuse", abandoned: "keep", expect: asId("rev-7") },
        handback: null,
      },
    ]);
    expect(moved.state.local.dialogs).toEqual([]);
  });

  test("a lone user message at the tip can be moved back to edit", () => {
    const moved = play(
      treeState("", {
        revision: asId("rev-1"),
        tip: { kind: "commit", id: asId("u1") },
        nodes: [node("u1", null, "user", "only message")],
      }),
      key("picker.accept"),
    );

    expect(moved.effects).toMatchObject([
      { kind: "move", position: { kind: "commit", id: asId("u1") } },
    ]);
  });

  test("a user message needs an empty composer", () => {
    const state = selectTree(treeState("draft"), "c1");

    expect(play(state, key("picker.accept")).state.local.notice?.text).toBe(
      "Clear the composer before editing a message",
    );
  });

  test("leaving the branch asks for a summary; a typed focus summarizes with it", () => {
    const state = selectTree(treeState(), "c4");
    const asked = play(state, key("picker.accept"));

    expect(top(asked.state)).toMatchObject({
      kind: "list",
      purpose: { kind: "summary", target: "c4" },
    });

    const moved = play(
      asked.state,
      key("picker.previous"),
      { kind: "dialog", command: { kind: "query", text: "the failing test" } },
      key("picker.accept"),
    );

    expect(moved.effects).toEqual([
      {
        kind: "move",
        session: S1,
        position: { kind: "commit", id: asId("c4") },
        options: {
          running: "refuse",
          abandoned: { summarize: { instructions: "the failing test" } },
          expect: asId("rev-7"),
        },
        handback: null,
      },
    ]);
    expect(moved.state.local.dialogs).toEqual([]);
  });

  test("Esc on the summary goes back to the tree at the pick", () => {
    const asked = play(selectTree(treeState(), "c4"), key("picker.accept"), key("picker.close"));

    expect(treeDialog(asked.state)?.selected).toBe(asId("c4"));
  });

  test("moving to a user message hands it back once the view no longer shows it landed", () => {
    const state = selectTree(treeState(), "c1");

    const moving = play(state, key("picker.accept"), {
      kind: "dialog",
      command: { kind: "key", name: "picker.accept" },
    });

    expect(moving.effects[0]).toMatchObject({
      kind: "move",
      position: { kind: "commit", id: "c1" },
    });

    const outcome = play(moving.state, {
      kind: "moved",
      outcome: {
        kind: "moved",
        revision: asId("rev-8"),
        position: { kind: "start" },
        summary: null,
        handback: "first",
      },
      handback: null,
    });

    expect(outcome.state.local.notice?.text).toBe(
      "Message moved back to the composer. Enter sends it again.",
    );
    expect(outcome.state.local.draft.text).toBe("first");
  });

  test("filters toggle, folds and search interact, Ctrl+X copies", () => {
    const state = treeState();

    expect(treeDialog(play(state, key("tree.filter.users")).state)?.filter).toBe("users");
    expect(
      treeDialog(play(state, key("tree.filter.users"), key("tree.filter.users")).state)?.filter,
    ).toBe("default");
    expect(treeDialog(play(state, key("tree.filter.next")).state)?.filter).toBe("no-tools");

    const users = treeDialog(play(state, key("tree.filter.users")).state);

    expect(users === null ? [] : treeRows(users).map((row) => String(row.oid))).toEqual([
      "c1",
      "c3",
      "c4",
    ]);
    expect(play(state, key("tree.copy")).effects).toEqual([{ kind: "copy", text: "second" }]);
  });
});
