import { expect, test } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { AppInfo, AppMenuCommand } from "@nyte-ai/app/bridge.ts";
import { clientActions } from "@nyte-ai/app/client-actions.ts";
import { applicationMenuTemplate, createMenuCommandDelivery } from "./app-menu.ts";

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

// macOS adds SF Symbol icons, which need Electron's nativeImage; its File items are the same.
test.each(["linux", "win32"] as const)(
  "on %s the primary W closes a tab and closing the window takes Shift",
  (platform) => {
    const template = applicationMenuTemplate({
      platform,
      name: "Nyte",
      appInfo: () => info,
      dispatch: () => {},
      newWindow: () => {},
    });

    const items = (entries: readonly MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
      entries.flatMap((item) => [
        item,
        ...(Array.isArray(item.submenu) ? items(item.submenu) : []),
      ]);

    const all = items(template);

    const labelled = (accelerator: string) =>
      all.filter((item) => item.accelerator === accelerator).map((item) => item.label ?? item.role);

    expect(labelled("CommandOrControl+W")).toEqual(["Close Tab"]);
    expect(labelled("CommandOrControl+T")).toEqual(["New Tab"]);
    expect(labelled("Shift+CommandOrControl+T")).toEqual(["Reopen Closed Tab"]);
    expect(all.filter((item) => item.role === "close").map((item) => item.accelerator)).toEqual([
      "Shift+CommandOrControl+W",
    ]);
  },
);
