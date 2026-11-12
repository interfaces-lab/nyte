import { Menu } from "electron";
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions } from "electron";
import type { CallInput, CallOutput } from "../../shared/ipc.ts";

export async function showContextMenu({
  window,
  input: { items, x, y },
}: {
  readonly window: BrowserWindow | undefined;
  readonly input: CallInput<"host.contextMenu">;
}): Promise<CallOutput<"host.contextMenu">> {
  if (window === undefined || window.isDestroyed() || items.length === 0) return undefined;

  return new Promise<number | undefined>((resolve) => {
    const template = items.map<MenuItemConstructorOptions>((item, index) => {
      switch (item.kind) {
        case "separator":
          return { type: "separator" };
        case "role":
          return { role: item.role, label: item.label };
        case "item":
          return {
            label: item.label,
            accelerator: item.accelerator,
            registerAccelerator: false,
            enabled: item.enabled ?? true,
            click: () => resolve(index),
          };
        default: {
          const _exhaustive: never = item;

          return _exhaustive;
        }
      }
    });

    Menu.buildFromTemplate(template).popup({
      window,
      x: Math.round(x),
      y: Math.round(y),
      callback: () => resolve(undefined),
    });
  });
}

export function showEditableMenu(window: BrowserWindow, params: ContextMenuParams): void {
  if (!params.isEditable) return;
  const word = params.misspelledWord;

  const spelling: MenuItemConstructorOptions[] =
    word === ""
      ? []
      : [
          ...(params.dictionarySuggestions.length === 0
            ? [{ label: "No Guesses Found", enabled: false }]
            : params.dictionarySuggestions.map((suggestion) => ({
                label: suggestion,
                click: () => window.webContents.replaceMisspelling(suggestion),
              }))),
          {
            label: "Learn Spelling",
            click: () => window.webContents.session.addWordToSpellCheckerDictionary(word),
          },
          { type: "separator" },
        ];

  Menu.buildFromTemplate([
    ...spelling,
    { role: "undo", enabled: params.editFlags.canUndo },
    { role: "redo", enabled: params.editFlags.canRedo },
    { type: "separator" },
    { role: "cut", enabled: params.editFlags.canCut },
    { role: "copy", enabled: params.editFlags.canCopy },
    { role: "paste", enabled: params.editFlags.canPaste },
    { type: "separator" },
    { role: "selectAll", enabled: params.editFlags.canSelectAll },
  ]).popup({ window, frame: params.frame ?? undefined });
}
