import { Mods } from "./constants.ts";

import type { KeyInput, Modifiers } from "./index.ts";

const usLayout = new Map([
  ["Space", " "],
  ["Minus", "-"],
  ["Equal", "="],
  ["BracketLeft", "["],
  ["BracketRight", "]"],
  ["Backslash", "\\"],
  ["Semicolon", ";"],
  ["Quote", "'"],
  ["Backquote", "`"],
  ["Comma", ","],
  ["Period", "."],
  ["Slash", "/"],
]);

const rightSides = new Map([
  ["ShiftRight", Mods.SHIFT_SIDE],
  ["ControlRight", Mods.CTRL_SIDE],
  ["AltRight", Mods.ALT_SIDE],
  ["MetaRight", Mods.SUPER_SIDE],
]);

const segmenter = new Intl.Segmenter();

interface KeyText {
  readonly text: string;
  readonly unshifted: number;
  readonly mods: number;
  readonly consumed: number;
}

export function readKey(input: KeyInput): KeyText {
  const produced = printable(input.key);
  const unshifted = unshiftedCodepoint(input.code, produced);
  const mods = modifierBits(input) | (rightSides.get(input.code) ?? 0);
  const consumedShift = input.shift && produced !== "" ? Mods.SHIFT : 0;
  const consumedAlt = input.alt && !input.optionAsAlt && produced !== "" ? Mods.ALT : 0;

  return { text: produced, unshifted, mods, consumed: consumedShift | consumedAlt };
}

export function modifierBits(input: Modifiers) {
  return (
    (input.shift ? Mods.SHIFT : 0) |
    (input.ctrl ? Mods.CTRL : 0) |
    (input.alt ? Mods.ALT : 0) |
    (input.meta ? Mods.SUPER : 0)
  );
}

function printable(key: string) {
  const first = key.codePointAt(0) ?? 0;
  const control = first < 0x20 || first === 0x7f || (first >= 0xf700 && first <= 0xf8ff);

  if (key === "" || control) return "";

  return [...segmenter.segment(key)].length === 1 ? key : "";
}

function unshiftedCodepoint(code: string, produced: string) {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  const digit = /^Digit([0-9])$/.exec(code)?.[1];
  const base = letter?.toLowerCase() ?? digit ?? usLayout.get(code) ?? produced.toLowerCase();

  return base.codePointAt(0) ?? 0;
}
