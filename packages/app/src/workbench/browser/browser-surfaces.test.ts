import assert from "node:assert/strict";
import { test } from "vitest";
import { applyBrowserAgentOpened } from "./browser-surfaces.ts";
import { browserSurface } from "../model.ts";
import { workbenchViewKey } from "../paths.ts";
import { createWorkbenchStore } from "../store.ts";

test("an agent's page adds a quiet Browser tab showing that page, and leaves the user's tab alone", () => {
  const workbench = createWorkbenchStore(() => ({ browser: true }));
  const owner = "/workspace/agent";
  const view = workbenchViewKey(owner);
  const surface = "stage:session:agent";

  workbench.dispatch(view, {
    kind: "add",
    tab: { id: "mine", kind: "browser", url: "https://mine.test/", surface: null },
  });
  workbench.dispatch(view, { kind: "toggle" });
  applyBrowserAgentOpened(workbench, {
    kind: "browser_agent_opened",
    owner,
    surface,
    url: "https://a.test/",
  });

  const added = workbench.getView(view);
  assert.equal(added.expanded, false);
  assert.deepEqual(
    added.tabs.map((tab) => tab.kind === "browser" && [browserSurface(tab), tab.url]),
    [
      ["mine", "https://mine.test/"],
      [surface, "https://a.test/"],
    ],
  );

  applyBrowserAgentOpened(workbench, {
    kind: "browser_agent_opened",
    owner,
    surface,
    url: "https://b.test/",
  });

  assert.deepEqual(workbench.getView(view).tabs, added.tabs);
  assert.deepEqual(workbench.getView(workbenchViewKey(undefined)).tabs, []);
});
