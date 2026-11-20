import type { MessageBoxSyncOptions } from "electron";

const DISCARD = 0;

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
    windowEnded: (window: number): void => void holding.delete(window),
    mayClose: (window: number): boolean =>
      !holding.has(window) || discard("Your unsaved changes in this window will be lost.", window),
    mayQuit: (): boolean =>
      holding.size === 0 || discard("Your unsaved changes will be lost.", undefined),
  };
}
