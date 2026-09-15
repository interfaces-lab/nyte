/**
 * Renderer surfaces describe their right-click menu; main pops it natively.
 * A native menu needs no overlay occlusion to sit above browser pages, and
 * clipboard roles act on the focused web contents with full format fidelity.
 */
import { Menu } from "electron";
import type { BrowserWindow, MenuItemConstructorOptions } from "electron";
import type { HostBridge } from "../shared/ipc.ts";

export async function showContextMenu({
  window,
  input: { items, x, y },
}: {
  readonly window: BrowserWindow | undefined;
  readonly input: Parameters<HostBridge["contextMenu"]>[0];
}): Promise<number | undefined> {
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
            // The accelerator only labels the row; the renderer owns the shortcut.
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
