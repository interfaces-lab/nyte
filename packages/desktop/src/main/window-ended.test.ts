import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { stepWindowAttention } from "../shared/attention.ts";
import type { AttentionWindows } from "../shared/attention.ts";
import type { WindowEnd } from "../shared/host-window.ts";
import { createWindowWorkspaces } from "../shared/window-workspace.ts";
import { createMenuCommandDelivery } from "./app-menu.ts";
import { createUnsavedEdits } from "./unsaved-edits.ts";

test.each<{ readonly end: WindowEnd; readonly survives: readonly string[] }>([
  { end: "navigated", survives: ["selection", "seed", "opening"] },
  { end: "crashed", survives: ["selection", "seed", "opening"] },
  { end: "closed", survives: [] },
])("a window whose page $end keeps $survives", (row) => {
  const workspaces = createWindowWorkspaces();
  workspaces.opened(1, undefined);
  workspaces.shown(1, "/project");
  workspaces.opened(2, "/seed");

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
    workspaces.windowEnded(window, row.end);
    attention = stepWindowAttention(attention, { kind: "ended", window, end: row.end }).windows;
    unsaved.windowEnded(window);
  }

  menu.windowEnded();

  unsaved.mayClose(1);
  menu.dispatch({ kind: "action", action: "chat.new", input: {} });

  const held = {
    selection: workspaces.workspace(1) !== undefined,
    seed: workspaces.workspace(2) !== undefined,
    viewing: attention.has(1),
    opening: attention.has(2),
    "unsaved edits": asked.length > 0,
    "menu ready": sent.length > 0,
  };

  expect(Object.entries(held).flatMap((entry) => (entry[1] ? [entry[0]] : []))).toEqual(
    row.survives,
  );
});
