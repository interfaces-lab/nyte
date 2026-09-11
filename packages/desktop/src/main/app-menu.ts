import type { MenuItemConstructorOptions } from "electron";
import type { AppMenuCommand } from "../shared/app-menu.ts";
import { clientActionAccelerator, clientActions } from "../shared/client-actions.ts";

export function applicationMenuTemplate(options: {
  platform: NodeJS.Platform;
  name: string;
  settings: () => void;
  about: () => void;
}): MenuItemConstructorOptions[] {
  const about = { label: `About ${options.name}`, click: options.about };
  const settings = {
    label: "Settings…",
    accelerator: clientActionAccelerator(clientActions.settings),
    click: options.settings,
  };
  const update = { id: "check-for-updates", label: "Check for Updates…" };
  return [
    ...(options.platform === "darwin"
      ? [
          {
            label: options.name,
            submenu: [
              about,
              update,
              { type: "separator" },
              settings,
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    options.platform === "darwin"
      ? { role: "fileMenu" }
      : { label: "File", submenu: [settings, { type: "separator" }, { role: "quit" }] },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    { role: "help", submenu: options.platform === "darwin" ? [] : [about, update] },
  ];
}

/** Menu actions can reopen a closed window before its renderer has subscribed. */
export function createMenuCommandDelivery(options: {
  openWindow: () => void;
  send: (command: AppMenuCommand) => void;
}) {
  let ready = false;
  let pending: AppMenuCommand | undefined;
  return {
    dispatch(command: AppMenuCommand): void {
      options.openWindow();
      if (ready) options.send(command);
      else pending = command;
    },
    ready(): void {
      ready = true;
      if (pending === undefined) return;
      const command = pending;
      pending = undefined;
      options.send(command);
    },
    reset(): void {
      ready = false;
    },
  };
}
