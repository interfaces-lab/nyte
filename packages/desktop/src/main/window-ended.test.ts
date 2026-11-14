import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect } from "vitest";
import { asId } from "@nyte-ai/schema";
import { stepWindowAttention } from "../shared/attention.ts";
import type { AttentionWindows } from "../shared/attention.ts";
import type { WindowEnd } from "../shared/host-window.ts";
import { socketTest, testDesktop } from "../host/fixtures/desktop-host.ts";
import type { TestDesktop } from "../host/fixtures/desktop-host.ts";
import { createMenuCommandDelivery } from "./app-menu.ts";
import { createUnsavedEdits } from "./unsaved-edits.ts";

const opened: TestDesktop[] = [];

afterEach(async () => {
  for (const desktop of opened.splice(0)) await desktop.close();
});

socketTest.each<{ readonly end: WindowEnd; readonly survives: readonly string[] }>([
  { end: "navigated", survives: ["seed", "opening"] },
  { end: "crashed", survives: ["seed", "opening", "menu ready"] },
  { end: "closed", survives: [] },
])("a window whose page $end keeps $survives", async (row) => {
  const desktop = await testDesktop();
  opened.push(desktop);
  const folder = join(desktop.home, "project");
  await mkdir(folder);
  await desktop.host.call(1, "host.openWorkspace", { path: folder });
  desktop.host.seedWorkspace(2, { id: asId("seed"), path: "/seed", name: "seed" });

  let attention: AttentionWindows = new Map([
    [1, { kind: "ready", viewed: "viewed" }],
    [2, { kind: "loading", opening: asId<"session">("opening") }],
  ]);

  const asked: (number | undefined)[] = [];

  const unsaved = createUnsavedEdits((_options, window) => {
    asked.push(window);

    return 1;
  });

  unsaved.report(1, true);
  const sent: unknown[] = [];

  const menu = createMenuCommandDelivery({
    openWindow: () => undefined,
    send: (command) => sent.push(command),
  });

  menu.ready();

  for (const window of [1, 2]) {
    desktop.host.windowEnded(window, row.end);
    attention = stepWindowAttention(attention, { kind: "ended", window, end: row.end }).windows;
    unsaved.windowEnded(window);
  }

  menu.windowEnded(row.end);

  unsaved.mayClose(1);
  menu.dispatch({ kind: "action", action: "new-chat" });

  const held = {
    selection: desktop.host.selectedWorkspace(1) !== undefined,
    seed: desktop.host.selectedWorkspace(2) !== undefined,
    viewing: attention.has(1),
    opening: attention.has(2),
    "unsaved edits": asked.length > 0,
    "menu ready": sent.length > 0,
  };

  expect(Object.entries(held).flatMap((entry) => (entry[1] ? [entry[0]] : []))).toEqual(
    row.survives,
  );
});
