import type { FieldCommand } from "../../lib/constants.ts";

export interface Field {
  readonly text: string;
  readonly caret: number;
  readonly anchor?: number;
}

export type FieldMove = "left" | "right" | "word-left" | "word-right" | "home" | "end";

export type FieldEdit =
  | { readonly kind: "insert"; readonly text: string }
  | { readonly kind: "move"; readonly to: FieldMove; readonly select?: boolean }
  | { readonly kind: "select-all" }
  | { readonly kind: "delete"; readonly to: FieldMove };

export const FIELD_EDITS: Readonly<Record<FieldCommand, FieldEdit>> = {
  "field.left": { kind: "move", to: "left" },
  "field.right": { kind: "move", to: "right" },
  "field.home": { kind: "move", to: "home" },
  "field.end": { kind: "move", to: "end" },
  "field.select.all": { kind: "select-all" },
  "field.select.left": { kind: "move", to: "left", select: true },
  "field.select.right": { kind: "move", to: "right", select: true },
  "field.select.home": { kind: "move", to: "home", select: true },
  "field.select.end": { kind: "move", to: "end", select: true },
  "field.select.word.left": { kind: "move", to: "word-left", select: true },
  "field.select.word.right": { kind: "move", to: "word-right", select: true },
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

function classifyGrapheme(grapheme: string): "space" | "word" | "other" {
  if (/^\s/u.test(grapheme)) return "space";

  return /^[\p{L}\p{N}_]/u.test(grapheme) ? "word" : "other";
}

function target(field: Field, to: FieldMove): number {
  const { text, caret } = field;

  if (to === "home") return 0;

  if (to === "end") return text.length;
  const segments = [...GRAPHEMES.segment(text)];

  if (to === "left" || to === "word-left") {
    const before = segments.filter((segment) => segment.index < caret).toReversed();

    if (to === "left") return before[0]?.index ?? 0;
    const start = before.findIndex((segment) => classifyGrapheme(segment.segment) !== "space");
    const word = before[start];

    if (word === undefined) return 0;
    const kind = classifyGrapheme(word.segment);

    const end = before.findIndex(
      (segment, index) => index > start && classifyGrapheme(segment.segment) !== kind,
    );

    return end === -1 ? 0 : (before[end - 1]?.index ?? 0);
  }

  const after = segments.filter((segment) => segment.index >= caret);

  if (to === "right") return after[1]?.index ?? text.length;
  const start = after.findIndex((segment) => classifyGrapheme(segment.segment) !== "space");
  const word = after[start];

  if (word === undefined) return text.length;
  const kind = classifyGrapheme(word.segment);

  const end = after.find(
    (segment, index) => index > start && classifyGrapheme(segment.segment) !== kind,
  );

  return end?.index ?? text.length;
}

export function editField(field: Field, edit: FieldEdit): Field {
  const caret = Math.max(0, Math.min(field.caret, field.text.length));
  const { text } = field;
  const anchor = Math.max(0, Math.min(field.anchor ?? caret, text.length));
  const from = Math.min(caret, anchor);
  const end = Math.max(caret, anchor);

  switch (edit.kind) {
    case "insert":
      return {
        text: `${text.slice(0, from)}${edit.text}${text.slice(end)}`,
        caret: from + edit.text.length,
      };
    case "select-all":
      return text === "" ? { text, caret: 0 } : { text, caret: text.length, anchor: 0 };
    case "move": {
      const next =
        !edit.select && from !== end && (edit.to === "left" || edit.to === "right")
          ? edit.to === "left"
            ? from
            : end
          : target({ text, caret }, edit.to);

      return edit.select && next !== anchor ? { text, caret: next, anchor } : { text, caret: next };
    }

    case "delete": {
      if (from !== end) return { text: `${text.slice(0, from)}${text.slice(end)}`, caret: from };

      const to = target({ text, caret }, edit.to);
      const start = Math.min(caret, to);

      return { text: `${text.slice(0, start)}${text.slice(Math.max(caret, to))}`, caret: start };
    }

    default: {
      const _exhaustive: never = edit;

      return _exhaustive;
    }
  }
}
