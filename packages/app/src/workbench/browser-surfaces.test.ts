import assert from "node:assert/strict";
import { test } from "vitest";
import { applyBrowserAgentOpened } from "./browser-surfaces.ts";
import { createWorkbenchController, workbenchViewKey } from "./controller.ts";

test("an agent's page adds a quiet Browser tab, then navigates it in place", () => {
  const controller = createWorkbenchController(() => ({ terminal: true, browser: true }));
  const owner = "/workspace/agent";
  const view = workbenchViewKey(owner);

  applyBrowserAgentOpened(controller, {
    kind: "browser_agent_opened",
    owner,
    url: "https://a.test/",
  });

  const added = controller.getView(view);
  assert.equal(added.expanded, false);
  assert.deepEqual(
    added.tabs.map((tab) => tab.kind === "browser" && tab.url),
    ["https://a.test/"],
  );

  applyBrowserAgentOpened(controller, {
    kind: "browser_agent_opened",
    owner,
    url: "https://b.test/",
  });

  const navigated = controller.getView(view);
  assert.equal(navigated.expanded, false);
  assert.deepEqual(
    navigated.tabs.map((tab) => tab.kind === "browser" && tab.url),
    ["https://b.test/"],
  );
  assert.equal(navigated.tabs[0]?.id, added.tabs[0]?.id);
  assert.deepEqual(controller.getView(workbenchViewKey(undefined)).tabs, []);
});
