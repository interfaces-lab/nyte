import assert from "node:assert/strict";
import { expect, test } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { AppInfo, AppMenuCommand } from "../shared/app-menu.ts";
import { clientActions } from "../shared/client-actions.ts";
import { applicationMenuTemplate, createMenuCommandDelivery } from "./app-menu.ts";

const info = {
  name: "Nyte",
  version: "0.0.2",
  electron: "44",
  chrome: "142",
  os: "macOS 26",
  arch: "arm64",
} satisfies AppInfo;

function submenu(item: MenuItemConstructorOptions | undefined) {
  assert.ok(Array.isArray(item?.submenu));
  return item.submenu;
}

function select(item: MenuItemConstructorOptions | undefined): void {
  assert.ok(item?.click !== undefined);
  Reflect.apply(item.click, undefined, []);
}

function template(
  platform: NodeJS.Platform,
  dispatch: (command: AppMenuCommand) => void = () => {},
) {
  return applicationMenuTemplate({
    platform,
    name: "Nyte",
    appInfo: () => info,
    dispatch,
  });
}

test("macOS exposes Nyte actions in its native File menu", () => {
  const commands: AppMenuCommand[] = [];
  const menu = template("darwin", (command) => commands.push(command));
  const file = submenu(menu.find((item) => item.label === "File"));
  expect(file.map((item) => item.label).filter(Boolean)).toEqual([
    "New Chat",
    "Open Folder…",
    "New Terminal",
    "New Browser",
  ]);
  expect(file.find((item) => item.label === "New Chat")?.accelerator).toBe("CommandOrControl+N");
  expect(file.find((item) => item.label === "Open Folder…")?.accelerator).toBe(
    "CommandOrControl+O",
  );
  expect(file.find((item) => item.label === "New Terminal")?.accelerator).toBe("Shift+Control+`");
  expect(file.some((item) => item.role === "close")).toBe(true);

  select(file.find((item) => item.label === "Open Folder…"));
  expect(commands).toEqual([{ kind: "action", action: clientActions.openFolder.id }]);
});

test("macOS keeps settings, updates, and application roles under Nyte", () => {
  const commands: AppMenuCommand[] = [];
  const menu = template("darwin", (command) => commands.push(command));
  const app = submenu(menu.find((item) => item.label === "Nyte"));
  const settings = app.find((item) => item.label === "Settings…");
  expect(settings?.accelerator).toBe("CommandOrControl+,");
  expect(app.find((item) => item.id === "check-for-updates")?.label).toBe("Check for Updates…");
  for (const role of ["services", "hide", "hideOthers", "unhide", "quit"]) {
    expect(app.some((item) => item.role === role)).toBe(true);
  }
  for (const role of ["editMenu", "viewMenu", "windowMenu", "help"]) {
    expect(menu.some((item) => item.role === role)).toBe(true);
  }

  select(settings);
  select(app.find((item) => item.label === "About Nyte"));
  expect(commands).toEqual([
    { kind: "action", action: clientActions.settings.id },
    { kind: "about", info },
  ]);
});

test.each(["linux", "win32"] as const)(
  "%s keeps updates in Help and settings in File",
  (platform) => {
    const menu = template(platform);
    expect(
      submenu(menu.find((item) => item.role === "help")).some(
        (item) => item.id === "check-for-updates",
      ),
    ).toBe(true);
    expect(
      submenu(menu.find((item) => item.label === "File")).some(
        (item) => item.accelerator === "CommandOrControl+,",
      ),
    ).toBe(true);
  },
);

test("a menu action that reopens a window waits for its IPC subscriber", () => {
  const received: AppMenuCommand[] = [];
  let opened = false;
  const delivery = createMenuCommandDelivery({
    openWindow: () => {
      opened = true;
    },
    send: (command) => {
      received.push(command);
    },
  });
  const settings = {
    kind: "action",
    action: clientActions.settings.id,
  } satisfies AppMenuCommand;
  delivery.dispatch(settings);
  expect(opened).toBe(true);
  expect(received).toEqual([]);
  delivery.ready();
  delivery.ready();
  expect(received).toEqual([settings]);
});

test("live commands arrive immediately, but reloaded windows wait again", () => {
  const received: AppMenuCommand[] = [];
  const delivery = createMenuCommandDelivery({
    openWindow: () => {},
    send: (command) => {
      received.push(command);
    },
  });
  const about = { kind: "about", info } satisfies AppMenuCommand;
  const settings = {
    kind: "action",
    action: clientActions.settings.id,
  } satisfies AppMenuCommand;
  delivery.ready();
  delivery.dispatch(about);
  expect(received).toEqual([about]);
  delivery.reset();
  delivery.dispatch(about);
  delivery.dispatch(settings);
  expect(received).toEqual([about]);
  delivery.ready();
  expect(received).toEqual([about, about, settings]);
});
