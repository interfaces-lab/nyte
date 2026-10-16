import { describe, expect, test } from "bun:test";
import { editField } from "../../src/model/dialogs/field.ts";
import type { FieldMove } from "../../src/model/dialogs/field.ts";

function at(marked: string) {
  const [before = "", after = ""] = marked.split("|");

  return { text: before + after, caret: before.length };
}

function shown(field: { readonly text: string; readonly caret: number }): string {
  return `${field.text.slice(0, field.caret)}|${field.text.slice(field.caret)}`;
}

const move = (marked: string, to: FieldMove) => shown(editField(at(marked), { kind: "move", to }));

const remove = (marked: string, to: FieldMove) =>
  shown(editField(at(marked), { kind: "delete", to }));

describe("moving", () => {
  test("one grapheme at a time, a cluster as one", () => {
    expect(move("ab|c", "left")).toBe("a|bc");
    expect(move("ab|c", "right")).toBe("abc|");
    expect(move("|abc", "left")).toBe("|abc");
    expect(move("abc|", "right")).toBe("abc|");
    expect(move("a👍🏽|b", "left")).toBe("a|👍🏽b");
    expect(move("a|👍🏽b", "right")).toBe("a👍🏽|b");
  });

  test("by word: spaces, then a run of word or of other characters", () => {
    expect(move("find the bug|", "word-left")).toBe("find the |bug");
    expect(move("find the |bug", "word-left")).toBe("find |the bug");
    expect(move("src/app.ts|", "word-left")).toBe("src/app.|ts");
    expect(move("|find the bug", "word-right")).toBe("find| the bug");
    expect(move("find| the bug", "word-right")).toBe("find the| bug");
    expect(move("a |", "word-left")).toBe("|a ");
  });

  test("to either end", () => {
    expect(move("ab|c", "home")).toBe("|abc");
    expect(move("ab|c", "end")).toBe("abc|");
  });
});

describe("editing", () => {
  test("select all supports replacement and either delete direction", () => {
    const selected = editField(at("old-token|"), { kind: "select-all" });

    expect(selected).toEqual({ text: "old-token", caret: 9, anchor: 0 });
    expect(editField(selected, { kind: "insert", text: "new-token" })).toEqual({
      text: "new-token",
      caret: 9,
    });
    expect(editField(selected, { kind: "delete", to: "left" })).toEqual({ text: "", caret: 0 });
    expect(editField(selected, { kind: "delete", to: "right" })).toEqual({ text: "", caret: 0 });
    expect(editField(selected, { kind: "move", to: "left" })).toEqual({
      text: "old-token",
      caret: 0,
    });
    expect(editField(selected, { kind: "move", to: "right" })).toEqual({
      text: "old-token",
      caret: 9,
    });
  });

  test("shift selection moves by complete graphemes and reverses without losing its anchor", () => {
    const selected = editField(at("a👍🏽|b"), { kind: "move", to: "left", select: true });

    expect(selected).toEqual({ text: "a👍🏽b", caret: 1, anchor: 5 });
    expect(editField(selected, { kind: "insert", text: "x" })).toEqual({ text: "axb", caret: 2 });
    expect(editField(selected, { kind: "move", to: "right", select: true })).toEqual({
      text: "a👍🏽b",
      caret: 5,
    });
  });

  test("text goes in at the caret", () => {
    expect(shown(editField(at("a|c"), { kind: "insert", text: "b" }))).toBe("ab|c");
  });

  test("deletes remove between the caret and the move's target", () => {
    expect(remove("ab|c", "left")).toBe("a|c");
    expect(remove("ab|c", "right")).toBe("ab|");
    expect(remove("find the| bug", "word-left")).toBe("find | bug");
    expect(remove("find |the bug", "word-right")).toBe("find | bug");
    expect(remove("find |the bug", "home")).toBe("|the bug");
    expect(remove("find |the bug", "end")).toBe("find |");
    expect(remove("|abc", "left")).toBe("|abc");
  });

  test("a caret past the end is clamped", () => {
    expect(shown(editField({ text: "ab", caret: 9 }, { kind: "insert", text: "c" }))).toBe("abc|");
  });
});
