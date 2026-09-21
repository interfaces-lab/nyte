import assert from "node:assert/strict";
import { test } from "vitest";
import { createWorkbenchController, activeWorkbenchTab, workbenchViewKey } from "./controller.ts";

test("the workbench toggle recovers an unavailable expanded tab and then closes it", () => {
  const controller = createWorkbenchController();
  const view = workbenchViewKey({ paneKey: "stage", target: { kind: "home" } });
  const scope = { kind: "pathless" } as const;
  controller.actions.openTab({ view, tab: { kind: "files" }, activate: true });
  assert.equal(activeWorkbenchTab(controller.getView(view), scope), null);
  controller.actions.toggleWorkbench({ view, scope });
  assert.equal(controller.getView(view).expanded, true);
  assert.equal(activeWorkbenchTab(controller.getView(view), scope)?.kind, "browser");
  assert.deepEqual(
    controller.getView(view).tabs.map((tab) => tab.kind),
    ["files", "browser"],
  );
  controller.actions.toggleWorkbench({ view, scope });
  assert.equal(controller.getView(view).expanded, false);
  controller.actions.toggleWorkbench({ view, scope });
  assert.equal(controller.getView(view).expanded, true);
});
