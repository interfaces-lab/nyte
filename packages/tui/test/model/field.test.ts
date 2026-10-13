/** A dialog's typed field: caret moves by grapheme and word, deletes act from the caret. */
import { describe, expect, test } from "bun:test";
import { editField } from "../../src/model/dialogs/field.ts";
import type { FieldMove } from "../../src/model/dialogs/field.ts";

function at(marked: string) {
  return { text: marked.replace("|", ""), caret: marked.indexOf("|") };
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
