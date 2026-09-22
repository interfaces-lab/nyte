import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import { sessionSurfaceId } from "../../../main/browser-agent.ts";
import type { WorkbenchPersistence } from "./controller.ts";
import {
  clampWorkbenchWidthToBounds,
  createWorkbenchController,
  decodePersistedWorkbenchSnapshot,
  workbenchTabAvailable,
  WORKBENCH_STAGE_PANE_KEY,
  WORKBENCH_WIDTH_DEFAULT,
  workbenchTabs,
  workbenchScopeForTarget,
  workbenchViewKey,
  workbenchWidthBounds,
} from "./controller.ts";

const changes = {
  kind: "changes",
  scope: { kind: "uncommitted" },
  selectedPath: null,
  pathRevealRevision: 0,
  scrollTop: 0,
} as const;

describe("workbench capabilities", () => {
  test("keeps project actions out of pathless Home", () => {
    const home = workbenchScopeForTarget({ kind: "home" }, "/workspace");
    const project = workbenchScopeForTarget(
      { kind: "workspace", workspacePath: "/workspace" },
      undefined,
    );

    assert.deepEqual(workbenchTabs(home), ["browser", "terminal"]);
    assert.deepEqual(workbenchTabs(project), ["files", "changes", "browser", "terminal"]);
    assert.equal(workbenchTabAvailable(home, "file"), false);
    assert.equal(workbenchTabAvailable(project, "files"), true);
    assert.equal(workbenchTabAvailable(home, "changes"), false);
    assert.equal(workbenchTabAvailable(home, "browser"), true);
  });

  test("gives Home a stable view identity", () => {
    const first = workbenchViewKey({ paneKey: "stage", target: { kind: "home" } });
    const second = workbenchViewKey({ paneKey: "stage", target: { kind: "home" } });

    assert.equal(first, second);
    assert.equal(first, "stage:home");
  });

  test("an agent-opened page lands on the same view key the Browser tab uses", () => {
    const sid = sessionId("ses_abc-123");
    const viewKey = workbenchViewKey({
      paneKey: WORKBENCH_STAGE_PANE_KEY,
      target: { kind: "session", sessionId: sid },
    });
    assert.equal(viewKey, sessionSurfaceId(sid));
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
});

describe("workbench tab reducer", () => {
  test("open dedupes structural identities and activates the existing tab", () => {
    const controller = createWorkbenchController();
    const view = workbenchViewKey({ paneKey: "open", target: { kind: "home" } });
    const first = controller.actions.openTab({
      view,
      tab: { kind: "file", path: "/workspace/a.ts", preview: true },
      activate: true,
    });
    const browser = controller.actions.openTab({
      view,
      tab: { kind: "browser", url: "about:blank" },
      activate: true,
    });
    const reopened = controller.actions.openTab({
      view,
      tab: { kind: "file", path: "/workspace/a.ts", preview: false },
      activate: true,
    });

    assert.equal(reopened, first);
    assert.notEqual(first, browser);
    assert.equal(controller.getView(view).tabs.length, 2);
    assert.equal(controller.getView(view).active, first);

    const sid = sessionId("agent-terminal");
    const agent = controller.actions.openTab({
      view,
      tab: { kind: "terminal", owner: { kind: "agent", sessionId: sid, jobId: "job-1" } },
      activate: false,
    });
    const sameAgent = controller.actions.openTab({
      view,
      tab: { kind: "terminal", owner: { kind: "agent", sessionId: sid, jobId: "job-1" } },
      activate: true,
    });
    const otherSid = sessionId("other-agent-terminal");
    const otherAgent = controller.actions.openTab({
      view,
      tab: { kind: "terminal", owner: { kind: "agent", sessionId: otherSid, jobId: "job-1" } },
      activate: true,
    });
    const shell = controller.actions.openTab({
      view,
      tab: { kind: "terminal", owner: { kind: "user" } },
      activate: true,
    });
    const secondShell = controller.actions.openTab({
      view,
      tab: { kind: "terminal", owner: { kind: "user" } },
      activate: true,
    });

    assert.equal(sameAgent, agent);
    assert.notEqual(otherAgent, agent);
    assert.notEqual(shell, secondShell);
  });

  test("close selects the right neighbor, then the left neighbor", () => {
    const controller = createWorkbenchController();
    const view = workbenchViewKey({ paneKey: "close", target: { kind: "home" } });
    const left = controller.actions.openTab({ view, tab: changes, activate: true });
    const middle = controller.actions.openTab({
      view,
      tab: { kind: "browser", url: "about:blank" },
      activate: true,
    });
    const right = controller.actions.openTab({
      view,
      tab: { kind: "terminal", owner: { kind: "user" } },
      activate: true,
    });
    controller.actions.activateTab({ view, id: middle });

    controller.actions.closeTab({ view, id: middle });
    assert.equal(controller.getView(view).active, right);
    controller.actions.closeTab({ view, id: right });
    assert.equal(controller.getView(view).active, left);
  });

  test("move reorders tabs without changing activation", () => {
    const controller = createWorkbenchController();
    const view = workbenchViewKey({ paneKey: "move", target: { kind: "home" } });
    const first = controller.actions.openTab({ view, tab: changes, activate: true });
    const second = controller.actions.openTab({
      view,
      tab: { kind: "browser", url: "about:blank" },
      activate: true,
    });
    const third = controller.actions.openTab({ view, tab: { kind: "files" }, activate: true });

    controller.actions.moveTab({ view, id: first, index: 2 });
    assert.deepEqual(
      controller.getView(view).tabs.map((tab) => tab.id),
      [second, third, first],
    );
    assert.equal(controller.getView(view).active, third);
  });

  test("update narrows the patch by tab kind", () => {
    const controller = createWorkbenchController();
    const view = workbenchViewKey({ paneKey: "update", target: { kind: "home" } });
    const id = controller.actions.openTab({ view, tab: changes, activate: true });

    controller.actions.updateTab({
      view,
      id,
      kind: "changes",
      patch: {
        scope: { kind: "staged" },
        selectedPath: "src/a.ts",
        pathRevealRevision: 2,
        scrollTop: 120,
      },
    });

    assert.deepEqual(controller.getView(view).tabs[0], {
      id,
      kind: "changes",
      scope: { kind: "staged" },
      selectedPath: "src/a.ts",
      pathRevealRevision: 2,
      scrollTop: 120,
    });
  });

  test("persistence keeps the Changes scope and drops terminals", () => {
    let stored: string | undefined;
    const persistence: WorkbenchPersistence = {
      read: () => (stored === undefined ? undefined : decodePersistedWorkbenchSnapshot(stored)),
      write: (value) => {
        stored = JSON.stringify(value);
      },
    };
    const controller = createWorkbenchController(persistence);
    const view = workbenchViewKey({ paneKey: "persist", target: { kind: "home" } });
    const file = controller.actions.openTab({
      view,
      tab: { kind: "file", path: "/workspace/a.ts", preview: false },
      activate: true,
    });
    const change = controller.actions.openTab({ view, tab: changes, activate: true });
    controller.actions.updateTab({
      view,
      id: change,
      kind: "changes",
      patch: {
        scope: { kind: "commit", oid: "abc123" },
        selectedPath: "src/a.ts",
        pathRevealRevision: 4,
        scrollTop: 80,
      },
    });
    const browser = controller.actions.openTab({
      view,
      tab: { kind: "browser", url: "https://example.com" },
      activate: true,
    });
    const files = controller.actions.openTab({ view, tab: { kind: "files" }, activate: true });
    controller.actions.openTab({
      view,
      tab: { kind: "terminal", owner: { kind: "user" } },
      activate: true,
    });

    const restored = createWorkbenchController(persistence).getView(view);
    assert.deepEqual(
      restored.tabs.map((tab) => tab.id),
      [file, change, browser, files],
    );
    assert.equal(restored.active, file);
    assert.deepEqual(
      restored.tabs.find((tab) => tab.id === change),
      {
        id: change,
        kind: "changes",
        scope: { kind: "commit", oid: "abc123" },
        selectedPath: "src/a.ts",
        pathRevealRevision: 4,
        scrollTop: 80,
      },
    );
    assert.equal(
      decodePersistedWorkbenchSnapshot(JSON.stringify({ version: 5, views: [] })),
      undefined,
    );
  });
});
