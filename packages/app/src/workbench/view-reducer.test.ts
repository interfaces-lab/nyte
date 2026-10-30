import { expect, test } from "vitest";
import { DEFAULT_VIEW } from "./model.ts";
import type { WorkbenchPersistence } from "./persistence.ts";
import { createWorkbenchStore } from "./store.ts";
import { reduceView } from "./view-reducer.ts";
import { workbenchPanelWidth } from "./width.ts";

test("reopening Changes applies the requested scope and path to the open tab in one step", () => {
  const opened = reduceView(DEFAULT_VIEW, {
    kind: "open-changes",
    id: "first",
    scope: { kind: "uncommitted" },
    path: null,
  });

  const scrolled = reduceView(opened, {
    kind: "patch",
    id: "first",
    change: { kind: "changes", patch: { scrollTop: 30 } },
  });

  const reopened = reduceView(scrolled, {
    kind: "open-changes",
    id: "second",
    scope: { kind: "thread" },
    path: "src/last.ts",
  });

  expect(reopened).toMatchObject({
    active: "first",
    expanded: true,
    tabs: [
      {
        id: "first",
        kind: "changes",
        scope: { kind: "thread" },
        selectedPath: "src/last.ts",
        pathRevealRevision: 1,
        scrollTop: 0,
      },
    ],
  });
});

test("the panel takes half the stage, at least 384 px, and keeps its share as the window grows", () => {
  const stored: Parameters<WorkbenchPersistence["set"]>[0][] = [];

  const store = createWorkbenchStore(() => ({ browser: true }), {
    get: () => undefined,
    set: (value) => {
      stored.push(value);
    },
  });

  const view = "/workspace";

  expect(workbenchPanelWidth(store.getView(view).width, 1400)).toBe(700);
  expect(workbenchPanelWidth(store.getView(view).width, 900)).toBe(450);

  store.dispatch(view, { kind: "set-share", share: 0.25 });
  expect(workbenchPanelWidth(store.getView(view).width, 1400)).toBe(384);
  expect(workbenchPanelWidth(store.getView(view).width, 2000)).toBe(500);
  expect(stored.at(-1)?.views).toMatchObject([{ key: view, share: 0.25 }]);

  const reopened = createWorkbenchStore(() => ({ browser: true }), {
    get: () => stored.at(-1),
    set: () => undefined,
  });

  expect(workbenchPanelWidth(reopened.getView(view).width, 2000)).toBe(500);
});

test("a width stored in pixels stays until the next resize, and the old 400 px default becomes half", () => {
  const pixels = (width: number) =>
    createWorkbenchStore(() => ({ browser: true }), {
      get: () => ({
        version: 7,
        views: [
          { key: "/workspace", tabs: [], active: null, expanded: true, maximized: false, width },
        ],
      }),
      set: () => undefined,
    });

  const resized = pixels(520);
  expect(workbenchPanelWidth(resized.getView("/workspace").width, 1400)).toBe(520);
  expect(workbenchPanelWidth(resized.getView("/workspace").width, 2000)).toBe(520);
  expect(workbenchPanelWidth(pixels(400).getView("/workspace").width, 1400)).toBe(700);

  resized.dispatch("/workspace", { kind: "set-share", share: 0.4 });
  expect(workbenchPanelWidth(resized.getView("/workspace").width, 2000)).toBe(800);
});
