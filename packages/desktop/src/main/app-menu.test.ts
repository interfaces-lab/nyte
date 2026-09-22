import { expect, test } from "vitest";
import type { AppInfo, AppMenuCommand } from "../shared/app-menu.ts";
import { clientActions } from "../shared/client-actions.ts";
import { createMenuCommandDelivery } from "./app-menu.ts";

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
