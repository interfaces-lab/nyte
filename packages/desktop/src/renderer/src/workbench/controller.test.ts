import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { WorkbenchPersistence } from "./controller.ts";
import {
  clampWorkbenchWidthToBounds,
  createWorkbenchController,
  decodePersistedWorkbenchSnapshot,
  workbenchTabAvailable,
  WORKBENCH_WIDTH_DEFAULT,
  workbenchTabs,
  workbenchScopeForTarget,
  workbenchViewKey,
  workbenchWidthBounds,
} from "./controller.ts";

describe("workbench capabilities", () => {
  test("keeps project actions out of pathless Home", () => {
    const home = workbenchScopeForTarget({ kind: "home" }, "/workspace");
    const project = workbenchScopeForTarget(
      { kind: "workspace", workspacePath: "/workspace" },
      undefined,
    );

    assert.deepEqual(workbenchTabs(home), ["browser", "terminal"]);
    assert.deepEqual(workbenchTabs(project), ["changes", "browser", "terminal"]);
    assert.equal(workbenchTabAvailable(home, "changes"), false);
    assert.equal(workbenchTabAvailable(home, "browser"), true);
    assert.equal(workbenchTabAvailable(home, "terminal"), true);
  });

  test("gives Home a stable view identity", () => {
    const first = workbenchViewKey({ paneKey: "stage", target: { kind: "home" } });
    const second = workbenchViewKey({ paneKey: "stage", target: { kind: "home" } });

    assert.equal(first, second);
    assert.equal(first, "stage:home");
  });

  test("rejects obsolete launcher state", () => {
    assert.equal(
      decodePersistedWorkbenchSnapshot(
        JSON.stringify({
          version: 2,
          views: [
            {
              key: "stage:home",
              expanded: true,
              activeTab: "launcher",
              width: 500,
              scrollTop: { changes: 0 },
            },
          ],
        }),
      ),
      undefined,
    );
  });
});

describe("workbench geometry", () => {
  test("docks only when the panel and chat minimums both fit", () => {
    assert.deepEqual(workbenchWidthBounds(1_200), { kind: "docked", min: 384, max: 776 });
    assert.deepEqual(workbenchWidthBounds(807), { kind: "overlay", min: 384, max: 807 });
    assert.deepEqual(workbenchWidthBounds(320), { kind: "overlay", min: 320, max: 320 });
  });

  test("clamps persisted widths to the current stage instead of a fixed ceiling", () => {
    const bounds = workbenchWidthBounds(1_200);

    assert.equal(clampWorkbenchWidthToBounds(200, bounds), 384);
    assert.equal(clampWorkbenchWidthToBounds(WORKBENCH_WIDTH_DEFAULT, bounds), 500);
    assert.equal(clampWorkbenchWidthToBounds(4_000, bounds), 776);
  });

  test("choosing another file starts its patch from the top", () => {
    const controller = createWorkbenchController();
    const key = workbenchViewKey({ paneKey: "scroll-state", target: { kind: "home" } });

    controller.actions.selectPath(key, "src/a.ts");
    controller.actions.setScrollTop(key, "changes", 240);
    controller.actions.selectPath(key, "src/a.ts");
    assert.equal(controller.getView(key).scrollTop.changes, 240);

    controller.actions.selectPath(key, "src/b.ts");
    assert.equal(controller.getView(key).scrollTop.changes, 0);
  });

  test("both workbench toggles restore the selected panel and its state", () => {
    const controller = createWorkbenchController();
    const key = workbenchViewKey({ paneKey: "width-state", target: { kind: "home" } });

    controller.actions.setWidth(key, 640);
    controller.actions.setBrowserUrl(key, "https://example.com/");
    controller.actions.selectPath(key, "src/a.ts");
    controller.actions.setScrollTop(key, "changes", 240);
    controller.actions.openTab(key, "browser");
    controller.actions.toggle(key);
    assert.equal(controller.getView(key).expanded, false);
    controller.actions.toggle(key);

    assert.equal(controller.getView(key).expanded, true);
    assert.equal(controller.getView(key).activeTab, "browser");
    assert.equal(controller.getView(key).width, 640);
    assert.equal(controller.getView(key).browserUrl, "https://example.com/");
    assert.equal(controller.getView(key).selectedPath, "src/a.ts");
    assert.equal(controller.getView(key).scrollTop.changes, 240);
    assert.deepEqual(controller.getView(key).openTabs, ["browser"]);
  });
});

describe("workbench tabs", () => {
  test("closing an active tab selects its right neighbor, then its left neighbor", () => {
    const controller = createWorkbenchController();
    const key = workbenchViewKey({ paneKey: "closing", target: { kind: "home" } });
    controller.actions.openTab(key, "changes");
    controller.actions.openTab(key, "browser");
    controller.actions.openTab(key, "terminal");
    controller.actions.openTab(key, "browser");

    controller.actions.closeTab(key, "browser");
    assert.deepEqual(controller.getView(key).openTabs, ["changes", "terminal"]);
    assert.equal(controller.getView(key).activeTab, "terminal");
    assert.equal(controller.getView(key).expanded, true);

    controller.actions.closeTab(key, "terminal");
    assert.equal(controller.getView(key).activeTab, "changes");
  });

  test("closing an inactive tab preserves selection and cannot reopen on a visibility toggle", () => {
    const controller = createWorkbenchController();
    const key = workbenchViewKey({ paneKey: "inactive-close", target: { kind: "home" } });
    controller.actions.openTab(key, "browser");
    controller.actions.openTab(key, "terminal");
    controller.actions.closeTab(key, "browser");
    controller.actions.toggle(key);
    controller.actions.toggle(key);

    assert.equal(controller.getView(key).activeTab, "terminal");
    assert.deepEqual(controller.getView(key).openTabs, ["terminal"]);
  });

  test("closing the last tab returns to the rail; explicitly reopening restores its URL", () => {
    const controller = createWorkbenchController();
    const key = workbenchViewKey({ paneKey: "last-close", target: { kind: "home" } });
    controller.actions.setBrowserUrl(key, "https://example.com/");
    controller.actions.openTab(key, "browser");
    controller.actions.closeTab(key, "browser");

    assert.equal(controller.getView(key).activeTab, null);
    assert.equal(controller.getView(key).expanded, false);
    assert.deepEqual(controller.getView(key).openTabs, []);
    const closed = controller.getView(key);
    controller.actions.closeTab(key, "browser");
    assert.equal(controller.getView(key), closed);

    controller.actions.toggle(key);
    assert.equal(controller.getView(key).expanded, true);
    assert.equal(controller.getView(key).activeTab, "browser");
    assert.deepEqual(controller.getView(key).openTabs, ["browser"]);
    assert.equal(controller.getView(key).browserUrl, "https://example.com/");
  });

  test("persists open panels without restoring closed tabs or shells from a previous app run", () => {
    let stored: string | undefined;
    const persistence: WorkbenchPersistence = {
      read: () => (stored === undefined ? undefined : decodePersistedWorkbenchSnapshot(stored)),
      write: (value) => {
        stored = JSON.stringify(value);
      },
    };
    const controller = createWorkbenchController(persistence);
    const first = workbenchViewKey({ paneKey: "persist-first", target: { kind: "home" } });
    const second = workbenchViewKey({ paneKey: "persist-second", target: { kind: "home" } });
    controller.actions.openTab(first, "browser");
    controller.actions.openTab(first, "changes");
    controller.actions.closeTab(first, "browser");
    controller.actions.toggle(first);
    controller.actions.openTab(second, "browser");
    controller.actions.closeTab(second, "browser");
    controller.actions.openTab(second, "terminal");

    const restored = createWorkbenchController(persistence);
    assert.deepEqual(restored.getView(first).openTabs, ["changes"]);
    assert.equal(restored.getView(first).activeTab, "changes");
    assert.equal(restored.getView(first).expanded, false);
    assert.deepEqual(restored.getView(second).openTabs, []);
    assert.equal(restored.getView(second).activeTab, null);
  });

  test("migrates an existing hidden view to one open tab without losing saved panel state", () => {
    const persisted = decodePersistedWorkbenchSnapshot(
      JSON.stringify({
        version: 4,
        views: [
          {
            key: "stage:home",
            expanded: false,
            activeTab: "browser",
            width: 620,
            scrollTop: { changes: 240 },
            browserUrl: "https://example.com/",
          },
        ],
      }),
    );
    const controller = createWorkbenchController({ read: () => persisted, write: () => undefined });
    const key = workbenchViewKey({ paneKey: "stage", target: { kind: "home" } });
    assert.equal(controller.getView(key).expanded, false);
    assert.deepEqual(controller.getView(key).openTabs, ["browser"]);
    assert.equal(controller.getView(key).width, 620);
    assert.equal(controller.getView(key).browserUrl, "https://example.com/");
    assert.equal(controller.getView(key).scrollTop.changes, 240);
  });
});
