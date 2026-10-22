import { expect, test } from "vitest";
import { createWorkbenchController } from "./controller.ts";

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
