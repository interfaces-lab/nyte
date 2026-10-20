import { Menu } from "electron";
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import type { CallInput, CallOutput } from "../shared/ipc.ts";

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
