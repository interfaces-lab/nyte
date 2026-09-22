import { nativeImage } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import type { AppInfo, AppMenuCommand } from "../shared/app-menu.ts";
import { clientActionAccelerator, clientActions } from "../shared/client-actions.ts";

export function applicationMenuTemplate(options: {
  platform: NodeJS.Platform;
  name: string;
  appInfo: () => AppInfo;
  dispatch: (command: AppMenuCommand) => void;
  newWindow: () => void;
}): MenuItemConstructorOptions[] {
  const about = {
    label: `About ${options.name}`,
    click: () => options.dispatch({ kind: "about", info: options.appInfo() }),
  };

  const settings = {
    label: "Settings…",
    accelerator: clientActionAccelerator(clientActions.settings),
    click: () => options.dispatch({ kind: "action", action: clientActions.settings.id }),
  };

  const fileActions = [
    { label: "New Window", accelerator: "Shift+CommandOrControl+N", click: options.newWindow },
    {
      label: "New Chat",
      accelerator: clientActionAccelerator(clientActions.newChat),
      click: () => options.dispatch({ kind: "action", action: clientActions.newChat.id }),
    },
    {
      label: "Open Folder…",
      accelerator: clientActionAccelerator(clientActions.openFolder),
      click: () => options.dispatch({ kind: "action", action: clientActions.openFolder.id }),
    },
    { type: "separator" },
    {
      label: "New Terminal",
      accelerator: clientActionAccelerator(clientActions.newTerminal),
      click: () => options.dispatch({ kind: "action", action: clientActions.newTerminal.id }),
    },
    {
      label: "New Browser",
      click: () => options.dispatch({ kind: "action", action: clientActions.newBrowser.id }),
    },
  ] satisfies MenuItemConstructorOptions[];

  const update = { id: "check-for-updates", label: "Check for Updates…" };

  return [
    ...(options.platform === "darwin"
      ? [
          {
            label: options.name,
            submenu: [
              about,
              { ...update, icon: nativeImage.createMenuSymbol("arrow.down.circle") },
              { type: "separator" },
              { ...settings, icon: nativeImage.createMenuSymbol("gearshape") },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit", icon: nativeImage.createMenuSymbol("xmark.square") },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu:
        options.platform === "darwin"
          ? [...fileActions, { type: "separator" }, { role: "close" }]
          : [
              ...fileActions,
              { type: "separator" },
              settings,
              { type: "separator" },
              { role: "quit" },
            ],
    },
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
  const pending: AppMenuCommand[] = [];

  return {
    dispatch: (command: AppMenuCommand): void => {
      options.openWindow();

      if (ready) options.send(command);
      else pending.push(command);
    },
    ready(): void {
      ready = true;

      for (const command of pending.splice(0)) options.send(command);
    },
    reset(): void {
      ready = false;
    },
  };
}
