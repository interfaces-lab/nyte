import { expect, test } from "vitest";
import { createUnsavedEdits } from "./unsaved-edits.ts";

test.each<{
  readonly name: string;
  readonly reports: readonly (readonly [number, boolean])[];
  readonly leaving: { readonly kind: "close"; readonly window: number } | { readonly kind: "quit" };
  readonly answer: "Discard Changes" | "Cancel" | "Escape" | "Return";
  readonly allowed: boolean;
  readonly asked: readonly (number | undefined)[];
}>([
  {
    name: "a window without edits closes without asking",
    reports: [[2, true]],
    leaving: { kind: "close", window: 1 },
    answer: "Cancel",
    allowed: true,
    asked: [],
  },
  {
    name: "a window whose edits were saved closes without asking",
    reports: [
      [1, true],
      [1, false],
    ],
    leaving: { kind: "close", window: 1 },
    answer: "Cancel",
    allowed: true,
    asked: [],
  },
  {
    name: "closing a window with edits asks over it and closes on discard",
    reports: [[1, true]],
    leaving: { kind: "close", window: 1 },
    answer: "Discard Changes",
    allowed: true,
    asked: [1],
  },
  {
    name: "cancel keeps the window open",
    reports: [[1, true]],
    leaving: { kind: "close", window: 1 },
    answer: "Cancel",
    allowed: false,
    asked: [1],
  },
  {
    name: "Escape keeps the window open",
    reports: [[1, true]],
    leaving: { kind: "close", window: 1 },
    answer: "Escape",
    allowed: false,
    asked: [1],
  },
  {
    name: "the default button keeps the window open",
    reports: [[1, true]],
    leaving: { kind: "close", window: 1 },
    answer: "Return",
    allowed: false,
    asked: [1],
  },
  {
    name: "quitting with no edits asks nothing",
    reports: [[1, false]],
    leaving: { kind: "quit" },
    answer: "Cancel",
    allowed: true,
    asked: [],
  },
  {
    name: "quitting with edits in two windows asks once for the app",
    reports: [
      [1, true],
      [2, true],
    ],
    leaving: { kind: "quit" },
    answer: "Discard Changes",
    allowed: true,
    asked: [undefined],
  },
  {
    name: "cancel keeps the app running",
    reports: [
      [1, true],
      [2, true],
    ],
    leaving: { kind: "quit" },
    answer: "Cancel",
    allowed: false,
    asked: [undefined],
  },
])("$name", ({ reports, leaving, answer, allowed, asked }) => {
  const windows: (number | undefined)[] = [];

  const edits = createUnsavedEdits((options, window) => {
    windows.push(window);

    if (answer === "Escape") return options.cancelId ?? -1;

    if (answer === "Return") return options.defaultId ?? -1;

    return options.buttons?.indexOf(answer) ?? -1;
  });

  for (const [window, held] of reports) edits.report(window, held);

  expect(leaving.kind === "quit" ? edits.mayQuit() : edits.mayClose(leaving.window)).toBe(allowed);
  expect(windows).toEqual(asked);
});
