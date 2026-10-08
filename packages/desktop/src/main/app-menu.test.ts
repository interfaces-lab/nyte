import { expect, test } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { AppInfo, AppMenuCommand, BrowserKey } from "@nyte-ai/app/bridge.ts";
import { clientActions } from "@nyte-ai/app/client-actions.ts";
import {
  acceleratorMatches,
  applicationMenuTemplate,
  createMenuCommandDelivery,
  menuItemForKey,
} from "./app-menu.ts";

const info = {
  name: "Nyte",
  version: "0.0.2",
  electron: "44",
  chrome: "142",
  os: "macOS 26",
  arch: "arm64",
} satisfies AppInfo;

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

// macOS adds SF Symbol icons, which need Electron's nativeImage; every other platform shares one template.
test("off macOS the primary W closes a tab and closing the window takes Shift", () => {
  const dispatched: AppMenuCommand[] = [];

  const template = applicationMenuTemplate({
    platform: "linux",
    name: "Nyte",
    appInfo: () => info,
    dispatch: (command) => {
      dispatched.push(command);
    },
    newWindow: () => {},
    view: () => {},
  });

  const items = (entries: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
    entries.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? items(item.submenu) : [])]);

  const all = items(template);
  const primaryW = all.filter((item) => item.accelerator === "CommandOrControl+W");
  expect(primaryW).toHaveLength(1);
  const click = primaryW[0]?.click;

  if (click === undefined) throw new Error("The primary W item has no click handler");
  // oxlint-disable-next-line no-restricted-globals, anti-slop/no-reflect-apply -- Electron's click wants a MenuItem only Electron can construct; the handler ignores its arguments
  Reflect.apply(click, undefined, []);
  expect(dispatched).toEqual([{ kind: "action", action: "close-tab" }]);
  expect(all.filter((item) => item.role === "close").map((item) => item.accelerator)).toEqual([
    "Shift+CommandOrControl+W",
  ]);
});

test("a key a page forwards runs the menu item a native key equivalent would", () => {
  const key = (init: Partial<BrowserKey> & Pick<BrowserKey, "key" | "code">): BrowserKey => ({
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    ...init,
  });

  const reload = key({ key: "r", code: "KeyR", metaKey: true });
  const hardReload = key({ key: "R", code: "KeyR", metaKey: true, shiftKey: true });

  expect(acceleratorMatches("CommandOrControl+R", reload, true)).toBe(true);
  expect(acceleratorMatches("CommandOrControl+R", reload, false)).toBe(false);
  expect(acceleratorMatches("CommandOrControl+R", hardReload, true)).toBe(false);
  expect(acceleratorMatches("Shift+CmdOrCtrl+R", hardReload, true)).toBe(true);
  expect(
    acceleratorMatches("CommandOrControl+Q", key({ key: "q", code: "KeyQ", ctrlKey: true }), false),
  ).toBe(true);
  expect(
    acceleratorMatches(
      "Alt+Command+I",
      key({ key: "\u02c6", code: "KeyI", metaKey: true, altKey: true }),
      true,
    ),
  ).toBe(true);
  expect(
    acceleratorMatches(
      "Shift+Control+`",
      key({ key: "~", code: "Backquote", ctrlKey: true, shiftKey: true }),
      true,
    ),
  ).toBe(true);
});

test("a forwarded key finds its item in a menu shaped like Electron's at runtime", () => {
  interface FakeItem {
    readonly label: string;
    readonly enabled: boolean;
    readonly visible: boolean;
    readonly accelerator: string | null;
    readonly submenu: { readonly items: readonly FakeItem[] } | null;
  }

  const leaf = (label: string, accelerator: string | null, enabled = true): FakeItem => ({
    label,
    enabled,
    visible: true,
    accelerator,
    submenu: null,
  });

  const branch = (label: string, items: readonly FakeItem[]): FakeItem => ({
    label,
    enabled: true,
    visible: true,
    accelerator: null,
    submenu: { items },
  });

  const menu = {
    items: [
      branch("Nyte", [leaf("About Nyte", null), leaf("Quit Nyte", "CommandOrControl+Q")]),
      branch("View", [
        leaf("Reload", "CommandOrControl+R"),
        leaf("Zoom In", "CommandOrControl+Plus", false),
      ]),
    ],
  };

  const command = (key: string, code: string): BrowserKey => ({
    key,
    code,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: true,
    repeat: false,
  });

  expect(menuItemForKey(menu, command("r", "KeyR"), true)?.label).toBe("Reload");
  expect(menuItemForKey(menu, command("q", "KeyQ"), true)?.label).toBe("Quit Nyte");
  expect(menuItemForKey(menu, command("+", "Equal"), true)).toBeUndefined();
  expect(menuItemForKey(menu, command("k", "KeyK"), true)).toBeUndefined();
});
