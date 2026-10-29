import { expect, test } from "vitest";
import { createWorkbenchController } from "./controller.ts";
import { workbenchPanelWidth } from "./width.ts";
import type { WorkbenchPersistence } from "./persistence.ts";

test.each(["successful", "failed"] as const)(
  "changes selected while panels are pending survive a %s load",
  async (outcome) => {
    const loading = Promise.withResolvers<void>();
    const published = Promise.withResolvers<void>();

    const controller = createWorkbenchController(() => ({ browser: true }), undefined, {
      ready: () => false,
      load: () => loading.promise,
    });

    const view = "/workspace";

    const first = controller.actions.openTab({
      view,
      tab: {
        kind: "changes",
        scope: { kind: "uncommitted" },
        selectedPath: null,
        pathRevealRevision: 0,
        scrollTop: 30,
      },
      activate: false,
    });

    const reused = controller.actions.openTab({
      view,
      tab: {
        kind: "changes",
        scope: { kind: "thread" },
        selectedPath: "src/first.ts",
        pathRevealRevision: 1,
        scrollTop: 0,
      },
      activate: true,
    });

    expect(reused).toBe(first);

    for (const path of ["src/first.ts", "src/last.ts"]) {
      controller.actions.updateTab({
        view,
        id: reused,
        kind: "changes",
        patch: {
          scope: { kind: "thread" },
          selectedPath: path,
          pathRevealRevision: 1,
          scrollTop: 0,
        },
      });
    }

    const unsubscribe = controller.subscribe(() => published.resolve());

    try {
      if (outcome === "successful") loading.resolve();
      else loading.reject(new Error("The panels chunk failed to load"));
      await published.promise;

      expect(controller.getView(view)).toMatchObject({
        active: first,
        expanded: true,
        tabs: [
          {
            id: first,
            kind: "changes",
            scope: { kind: "thread" },
            selectedPath: "src/last.ts",
            pathRevealRevision: 1,
            scrollTop: 0,
          },
        ],
      });

      controller.actions.updateTab({
        view,
        id: first,
        kind: "changes",
        patch: {
          scope: { kind: "staged" },
          selectedPath: "src/visible.ts",
          pathRevealRevision: 2,
          scrollTop: 12,
        },
      });
      expect(controller.getView(view).tabs).toEqual([
        {
          id: first,
          kind: "changes",
          scope: { kind: "staged" },
          selectedPath: "src/visible.ts",
          pathRevealRevision: 2,
          scrollTop: 12,
        },
      ]);
    } finally {
      unsubscribe();
    }
  },
);

test("the panel takes half the stage, at least 384 px, and keeps its share as the window grows", () => {
  const stored: Parameters<WorkbenchPersistence["write"]>[0][] = [];

  const controller = createWorkbenchController(() => ({ browser: true }), {
    read: () => undefined,
    write: (value) => stored.push(value),
  });

  const view = "/workspace";

  expect(workbenchPanelWidth(controller.getView(view).width, 1400)).toBe(700);
  expect(workbenchPanelWidth(controller.getView(view).width, 900)).toBe(450);

  controller.actions.setShare({ view, share: 0.25 });
  expect(workbenchPanelWidth(controller.getView(view).width, 1400)).toBe(384);
  expect(workbenchPanelWidth(controller.getView(view).width, 2000)).toBe(500);
  expect(stored.at(-1)?.views).toMatchObject([{ key: view, share: 0.25 }]);

  const reopened = createWorkbenchController(() => ({ browser: true }), {
    read: () => stored.at(-1),
    write: () => undefined,
  });

  expect(workbenchPanelWidth(reopened.getView(view).width, 2000)).toBe(500);
});

test("a width stored in pixels stays until the next resize, and the old 400 px default becomes half", () => {
  const pixels = (width: number) =>
    createWorkbenchController(() => ({ browser: true }), {
      read: () => ({
        version: 7,
        views: [
          { key: "/workspace", tabs: [], active: null, expanded: true, maximized: false, width },
        ],
      }),
      write: () => undefined,
    });

  const resized = pixels(520);
  expect(workbenchPanelWidth(resized.getView("/workspace").width, 1400)).toBe(520);
  expect(workbenchPanelWidth(resized.getView("/workspace").width, 2000)).toBe(520);
  expect(workbenchPanelWidth(pixels(400).getView("/workspace").width, 1400)).toBe(700);

  resized.actions.setShare({ view: "/workspace", share: 0.4 });
  expect(workbenchPanelWidth(resized.getView("/workspace").width, 2000)).toBe(800);
});
