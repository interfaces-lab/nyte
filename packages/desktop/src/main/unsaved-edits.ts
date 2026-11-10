import type { MessageBoxSyncOptions } from "electron";

const DISCARD = 0;

/**
 * The windows whose renderers report unsaved editor edits, and the question asked before closing
 * one of them or quitting would lose those edits. `ask` shows the message box over `window`, or
 * over the app, and returns the chosen button.
 */
export function createUnsavedEdits(
  ask: (options: MessageBoxSyncOptions, window: number | undefined) => number,
) {
  const holding = new Set<number>();

  const discard = (detail: string, window: number | undefined): boolean =>
    ask(
      {
        type: "warning",
        message: "Discard Changes",
        detail,
        buttons: ["Discard Changes", "Cancel"],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      },
      window,
    ) === DISCARD;

  return {
    report: (window: number, held: boolean): void => {
      if (held) holding.add(window);
      else holding.delete(window);
    },
    mayClose: (window: number): boolean =>
      !holding.has(window) || discard("Your unsaved changes in this window will be lost.", window),
    mayQuit: (): boolean =>
      holding.size === 0 || discard("Your unsaved changes will be lost.", undefined),
  };
}
