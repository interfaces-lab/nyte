import { expect, test } from "bun:test";
import { asId } from "@nyte-ai/schema";
import type { Dialog } from "../../../src/model/dialogs/dialog.ts";
import { renderDialog, rows } from "./harness.tsx";

const HEIGHT = 32;

const LIST: Dialog = {
  kind: "list",
  id: "l1",
  purpose: { kind: "question", session: asId("s1"), part: asId("p1"), typed: true },
  title: "Which one?",
  choices: {
    kind: "ready",
    items: [{ id: "a", label: "a", description: "", status: null, mark: null }],
  },
  query: "",
  highlighted: 0,
  answering: "",
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

function hintRow(frame: string): number {
  return rows(frame).findIndex((row) => row.includes("esc "));
}

test("nothing draws without a dialog", async () => {
  await using app = await renderDialog(null);

  expect(app.frame().trim()).toBe("");
});

test("the host switches placement with the top dialog", async () => {
  await using app = await renderDialog(LIST, { height: HEIGHT });

  expect(app.frame()).toContain("Which one?");
  expect(hintRow(app.frame())).toBeLessThan(HEIGHT / 2);

  await app.show([TEXT]);
  expect(app.frame()).toContain("Usage");
  expect(app.frame()).not.toContain("Which one?");
  expect(hintRow(app.frame())).toBe(HEIGHT - 2);

  await app.show([TREE]);
  expect(app.frame()).toContain("Session Tree");
  expect(hintRow(app.frame())).toBe(HEIGHT - 2);

  await app.show([TREE, LIST]);
  expect(app.frame()).toContain("Which one?");
  expect(app.frame()).not.toContain("Session Tree");

  await app.show([]);
  expect(app.frame().trim()).toBe("");
});
