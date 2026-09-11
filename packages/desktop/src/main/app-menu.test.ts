import assert from "node:assert/strict";
import { expect, test } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { AppMenuCommand } from "../shared/app-menu.ts";
import { applicationMenuTemplate, createMenuCommandDelivery } from "./app-menu.ts";

function submenu(item: MenuItemConstructorOptions | undefined) {
  assert.ok(Array.isArray(item?.submenu));
  return item.submenu;
}

test("macOS exposes Settings with Command-comma beside About and Updates", () => {
  const actions = { about: () => {}, settings: () => {} };
  const menu = applicationMenuTemplate({ platform: "darwin", name: "Nyte", ...actions });
  const app = submenu(menu.find((item) => item.label === "Nyte"));
  const settings = app.find((item) => item.label === "Settings…");
  expect(settings?.accelerator).toBe("CommandOrControl+,");
  expect(settings?.click).toBe(actions.settings);
  expect(app.find((item) => item.label === "About Nyte")?.click).toBe(actions.about);
  expect(app.find((item) => item.id === "check-for-updates")?.label).toBe("Check for Updates…");
  for (const role of ["services", "hide", "hideOthers", "unhide", "quit"]) {
    expect(app.some((item) => item.role === role)).toBe(true);
  }
  for (const role of ["fileMenu", "editMenu", "viewMenu", "windowMenu", "help"]) {
    expect(menu.some((item) => item.role === role)).toBe(true);
  }
});

test.each(["linux", "win32"] as const)(
  "%s keeps updates in Help and settings in File",
  (platform) => {
    const menu = applicationMenuTemplate({
      platform,
      name: "Nyte",
      about: () => {},
      settings: () => {},
    });
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
  delivery.dispatch({ kind: "settings" });
  expect(opened).toBe(true);
  expect(received).toEqual([]);
  delivery.ready();
  delivery.ready();
  expect(received).toEqual([{ kind: "settings" }]);
});

test("live commands arrive immediately, but reloaded windows wait again", () => {
  const received: AppMenuCommand[] = [];
  const delivery = createMenuCommandDelivery({
    openWindow: () => {},
    send: (command) => {
      received.push(command);
    },
  });
  const about = {
    kind: "about",
    info: {
      name: "Nyte",
      version: "0.0.2",
      electron: "44",
      chrome: "142",
      os: "macOS 26",
      arch: "arm64",
    },
  } satisfies AppMenuCommand;
  delivery.ready();
  delivery.dispatch(about);
  expect(received).toEqual([about]);
  delivery.reset();
  delivery.dispatch(about);
  delivery.dispatch({ kind: "settings" });
  expect(received).toEqual([about]);
  delivery.ready();
  expect(received).toEqual([about, { kind: "settings" }]);
});
