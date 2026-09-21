import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { createWorkbenchController, workbenchViewKey } from "./controller.ts";
import { createFileTabStore } from "./file-store.ts";

const first = { path: "/workspace/src/a.ts", displayPath: "src/a.ts" };
const second = { path: "/workspace/src/b.ts", displayPath: "src/b.ts" };
const third = { path: "/workspace/src/c.ts", displayPath: "src/c.ts" };
const key = workbenchViewKey({
  paneKey: "file-tests",
  target: { kind: "workspace", workspacePath: "/workspace" },
});

describe("file runtime store", () => {
  test("documents use controller tab IDs while order and activation stay in the controller", () => {
    const controller = createWorkbenchController();
    const store = createFileTabStore(controller);
    const changes = controller.actions.openTab({
      view: key,
      tab: {
        kind: "changes",
        scope: { kind: "uncommitted" },
        selectedPath: null,
        pathRevealRevision: 0,
        scrollTop: 0,
      },
      activate: true,
    });
    store.actions.open(key, first);
    store.actions.open(key, second);
    store.actions.open(key, { ...first, line: 12 });

    const tabs = store.getView(key).tabs;
    assert.equal(tabs.length, 2);
    assert.equal(tabs[0]?.line, 12);
    assert.equal(store.getView(key).activePath, first.path);
    assert.deepEqual(
      controller.getView(key).tabs.map((tab) => tab.kind),
      ["changes", "file", "file"],
    );
    assert.equal(controller.getView(key).tabs[0]?.id, changes);
    assert.equal(controller.getView(key).active, tabs[0]?.id);
  });

  test("drafts survive tab switches and remain isolated by tab ID", () => {
    const controller = createWorkbenchController();
    const store = createFileTabStore(controller);
    const other = workbenchViewKey({
      paneKey: "other-pane",
      target: { kind: "workspace", workspacePath: "/workspace" },
    });
    store.actions.open(key, first);
    store.actions.setDraft(key, first.path, {
      contents: "unsaved",
      savedContents: "disk",
      version: "v1",
    });
    store.actions.open(key, second);
    store.actions.open(other, first);
    store.actions.setDraft(other, first.path, {
      contents: "other draft",
      savedContents: "disk",
      version: "v1",
    });

    assert.equal(store.getView(key).tabs[0]?.draft?.contents, "unsaved");
    assert.equal(store.getView(other).tabs[0]?.draft?.contents, "other draft");
    assert.notEqual(store.getView(key).tabs[0]?.id, store.getView(other).tabs[0]?.id);
  });

  test("dirty close retains the controller tab until explicit discard", () => {
    const controller = createWorkbenchController();
    const store = createFileTabStore(controller);
    store.actions.open(key, first);
    store.actions.setDraft(key, first.path, {
      contents: "unsaved",
      savedContents: "disk",
      version: "v1",
    });

    assert.equal(store.actions.close(key, first.path), false);
    assert.equal(controller.getView(key).tabs.length, 1);
    store.actions.cancelClose(key);
    assert.equal(store.getView(key).tabs[0]?.draft?.contents, "unsaved");
    store.actions.close(key, first.path);
    store.actions.discardClose(key);
    assert.equal(controller.getView(key).tabs.length, 0);
  });

  test("clean previews replace each other while pinned files remain", () => {
    const controller = createWorkbenchController();
    const store = createFileTabStore(controller);
    store.actions.open(key, { ...first, preview: true });
    store.actions.open(key, { ...second, preview: true });
    store.actions.pin(key, second.path);
    store.actions.open(key, { ...third, preview: true });

    assert.deepEqual(
      store.getView(key).tabs.map((tab) => [tab.path, tab.preview]),
      [
        [second.path, false],
        [third.path, true],
      ],
    );
  });

  test("history restores file locations without owning tab activation", () => {
    const controller = createWorkbenchController();
    const store = createFileTabStore(controller);
    store.actions.open(key, { ...first, line: 10 });
    store.actions.open(key, { ...first, line: 20 });
    store.actions.open(key, second);
    store.actions.back(key);
    assert.equal(store.getView(key).activePath, first.path);
    assert.equal(store.getView(key).tabs[0]?.line, 20);
    store.actions.back(key);
    assert.equal(store.getView(key).tabs[0]?.line, 10);
  });
});
