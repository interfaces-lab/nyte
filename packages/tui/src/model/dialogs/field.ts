/**
 * A dialog's one-line text field: its text and caret, edited by the keys
 * OpenTUI's input binds (`FIELD_KEYBINDS`). The caret is a UTF-16 offset that
 * moves by grapheme; a word is a run of letters, digits and `_`, or of other
 * non-space characters.
 */
import type { FieldCommand } from "../../lib/constants.ts";

export interface Field {
  readonly text: string;
  readonly caret: number;
}

export type FieldMove = "left" | "right" | "word-left" | "word-right" | "home" | "end";

export type FieldEdit =
  | { readonly kind: "insert"; readonly text: string }
  | { readonly kind: "move"; readonly to: FieldMove }
  /** Removes the text between the caret and where `to` would move it. */
  | { readonly kind: "delete"; readonly to: FieldMove };

export const FIELD_EDITS: Readonly<Record<FieldCommand, FieldEdit>> = {
  "field.left": { kind: "move", to: "left" },
  "field.right": { kind: "move", to: "right" },
  "field.home": { kind: "move", to: "home" },
  "field.end": { kind: "move", to: "end" },
  "field.word.left": { kind: "move", to: "word-left" },
  "field.word.right": { kind: "move", to: "word-right" },
  "field.delete.left": { kind: "delete", to: "left" },
  "field.delete.right": { kind: "delete", to: "right" },
  "field.delete.word.left": { kind: "delete", to: "word-left" },
  "field.delete.word.right": { kind: "delete", to: "word-right" },
  "field.delete.home": { kind: "delete", to: "home" },
  "field.delete.end": { kind: "delete", to: "end" },
};

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function classOf(grapheme: string): "space" | "word" | "other" {
  if (/^\s/u.test(grapheme)) return "space";

  return /^[\p{L}\p{N}_]/u.test(grapheme) ? "word" : "other";
}

/** Where `to` moves the caret: one grapheme, past the next word, or to an end. */
function target(field: Field, to: FieldMove): number {
  const { text, caret } = field;

  if (to === "home") return 0;

  if (to === "end") return text.length;
  const segments = [...GRAPHEMES.segment(text)];

  if (to === "left" || to === "word-left") {
    const before = segments.filter((segment) => segment.index < caret).toReversed();

    if (to === "left") return before[0]?.index ?? 0;
    const start = before.findIndex((segment) => classOf(segment.segment) !== "space");
    const word = before[start];

    if (word === undefined) return 0;
    const kind = classOf(word.segment);

    const end = before.findIndex(
      (segment, index) => index > start && classOf(segment.segment) !== kind,
    );

    return end === -1 ? 0 : (before[end - 1]?.index ?? 0);
  }

  const after = segments.filter((segment) => segment.index >= caret);

  if (to === "right") return after[1]?.index ?? text.length;
  const start = after.findIndex((segment) => classOf(segment.segment) !== "space");
  const word = after[start];

  if (word === undefined) return text.length;
  const kind = classOf(word.segment);
  const end = after.find((segment, index) => index > start && classOf(segment.segment) !== kind);

  return end?.index ?? text.length;
}

export function editField(field: Field, edit: FieldEdit): Field {
  const caret = Math.max(0, Math.min(field.caret, field.text.length));
  const { text } = field;

  switch (edit.kind) {
    case "insert":
      return {
        text: `${text.slice(0, caret)}${edit.text}${text.slice(caret)}`,
        caret: caret + edit.text.length,
      };
    case "move":
      return { text, caret: target({ text, caret }, edit.to) };
    case "delete": {
      const to = target({ text, caret }, edit.to);
      const from = Math.min(caret, to);

      return { text: `${text.slice(0, from)}${text.slice(Math.max(caret, to))}`, caret: from };
    }

    default: {
      const _exhaustive: never = edit;

      return _exhaustive;
    }
  }
}
