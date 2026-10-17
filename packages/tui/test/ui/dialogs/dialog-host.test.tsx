import { expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { Dialog } from "../../../src/model/dialogs/dialog.ts";
import { renderDialog } from "./harness.tsx";

const LIST: Dialog = {
  kind: "list",
  id: "l1",
  purpose: { kind: "question", session: asId("s1"), part: asId("p1") },
  title: "Which one?",
  choices: {
    kind: "ready",
    items: [{ id: "a", label: "a", description: "", timing: null, status: null, mark: null }],
  },
  query: "",
  highlighted: 0,
  answering: null,
  busy: false,
};

const TEXT: Dialog = {
  kind: "text",
  id: "x1",
  title: "Usage",
  body: { kind: "ready", lines: ["some usage"] },
  scroll: 0,
};

const TREE: Dialog = {
  kind: "tree",
  id: "t1",
  tree: { kind: "loading" },
  filter: "default",
  query: "",
  folded: new Set(),
  selected: null,
  composerEmpty: true,
};

test("the host draws the top dialog of the stack", async () => {
  await using app = await renderDialog(LIST);

  expect(app.frame()).toContain("Which one?");

  await app.show([TEXT]);
  expect(app.frame()).toContain("Usage");
  expect(app.frame()).not.toContain("Which one?");

  await app.show([TREE, LIST]);
  expect(app.frame()).toContain("Which one?");
  expect(app.frame()).not.toContain("Chat Tree");

  await app.show([]);
  expect(app.frame().trim()).toBe("");
});

test("a terminal paste reaches the dialog that shows", async () => {
  await using app = await renderDialog(LIST);

  await app.mockInput.pasteBracketedText("blue");

  expect(app.dispatched).toContainEqual({
    kind: "dialog",
    command: { kind: "paste", text: "blue" },
  });
});
