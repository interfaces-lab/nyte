import assert from "node:assert/strict";
import { test } from "vitest";
import { createWorkbenchController, activeWorkbenchTab, workbenchViewKey } from "./controller.ts";

test("the workbench toggle recovers an unavailable expanded tab and then closes it", () => {
  const controller = createWorkbenchController();
  const key = workbenchViewKey({ paneKey: "stage", target: { kind: "home" } });
  const scope = { kind: "pathless" } as const;
  controller.actions.openTab(key, "files");
  assert.equal(activeWorkbenchTab(controller.getView(key), scope), null);
  controller.actions.toggleWorkbench(key, scope);
  assert.equal(controller.getView(key).expanded, true);
  assert.equal(activeWorkbenchTab(controller.getView(key), scope), "browser");
  assert.deepEqual(controller.getView(key).openTabs, ["files", "browser"]);
  controller.actions.toggleWorkbench(key, scope);
  assert.equal(controller.getView(key).expanded, false);
  controller.actions.toggleWorkbench(key, scope);
  assert.equal(controller.getView(key).expanded, true);
});
