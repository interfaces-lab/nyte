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

describe("file tabs", () => {
  test("opening and selecting files reveals Files without changing Changes selection", () => {
    const controller = createWorkbenchController();
    const store = createFileTabStore(controller);
    controller.actions.openTab(key, "changes");
    controller.actions.selectPath(key, "diff-only.ts");
    store.actions.open(key, first);
    store.actions.open(key, second);
    store.actions.open(key, { ...first, line: 12 });

    assert.equal(store.getView(key).tabs.length, 2);
    assert.equal(store.getView(key).activePath, first.path);
    assert.equal(store.getView(key).tabs[0]?.line, 12);
    assert.equal(controller.getView(key).activeTab, "files");
    assert.deepEqual(controller.getView(key).openTabs, ["changes", "files"]);
    assert.equal(controller.getView(key).selectedPath, "diff-only.ts");

    controller.actions.openTab(key, "browser");
    store.actions.select(key, second.path);
    assert.equal(controller.getView(key).activeTab, "files");
    assert.equal(store.getView(key).activePath, second.path);
    store.actions.select(key, "/missing.ts");
    assert.equal(store.getView(key).activePath, second.path);
  });

  test("drafts survive file, panel and view switches, but do not cross views", () => {
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
    controller.actions.openTab(key, "changes");
    store.actions.open(other, first);
    store.actions.setDraft(other, first.path, {
      contents: "other draft",
      savedContents: "disk",
      version: "v1",
    });
    store.actions.select(key, first.path);

    assert.equal(store.getView(key).tabs[0]?.draft?.contents, "unsaved");
    assert.equal(store.getView(other).tabs[0]?.draft?.contents, "other draft");
    store.actions.setDraft(key, first.path, {
      contents: "new edit",
      savedContents: "disk",
      version: "v1",
    });
    assert.equal(store.getView(key).tabs[0]?.draft?.revision, 2);
    store.actions.setDraft(key, first.path, undefined);
    assert.equal(store.getView(key).tabs[0]?.dirty, false);
    assert.equal(store.getView(key).tabs[0]?.draft, undefined);
    assert.equal(store.getView(other).tabs[0]?.dirty, true);
  });

  test("dirty close retains the file until explicit discard, and cancel preserves edits", () => {
    const store = createFileTabStore(createWorkbenchController());
    store.actions.open(key, first);
    store.actions.setDraft(key, first.path, {
      contents: "unsaved",
      savedContents: "disk",
      version: "v1",
    });
    assert.equal(store.actions.close(key, first.path), false);
    assert.equal(store.getView(key).pendingClosePath, first.path);
    assert.equal(store.getView(key).activePath, first.path);
    assert.equal(store.getView(key).tabs[0]?.draft?.contents, "unsaved");

    store.actions.cancelClose(key);
    store.actions.discardClose(key);
    assert.equal(store.getView(key).pendingClosePath, undefined);
    assert.equal(store.getView(key).tabs[0]?.draft?.contents, "unsaved");

    store.actions.close(key, first.path);
    store.actions.discardClose(key);
    assert.equal(store.getView(key).tabs.length, 0);
    assert.equal(store.getView(key).activePath, undefined);
    assert.equal(store.getView(key).pendingClosePath, undefined);
    store.actions.setDraft(key, first.path, {
      contents: "late editor completion",
      savedContents: "disk",
      version: "v1",
    });
    store.actions.open(key, first);
    assert.equal(store.getView(key).tabs[0]?.draft, undefined);
    assert.equal(store.getView(key).tabs[0]?.dirty, false);
  });

  test("dirty flags protect panel-owned drafts too", () => {
    const store = createFileTabStore(createWorkbenchController());
    store.actions.open(key, first);
    store.actions.setDirty(key, first.path, true);
    assert.equal(store.actions.close(key, first.path), false);
    store.actions.cancelClose(key);
    store.actions.setDirty(key, first.path, false);
    assert.equal(store.actions.close(key, first.path), true);
    assert.equal(store.getView(key).tabs.length, 0);
  });

  test("closing selects the right neighbor then the left, leaving the Files placeholder open", () => {
    const controller = createWorkbenchController();
    const store = createFileTabStore(controller);
    store.actions.open(key, first);
    store.actions.open(key, second);
    store.actions.open(key, third);
    store.actions.select(key, second.path);
    store.actions.close(key, second.path);
    assert.equal(store.getView(key).activePath, third.path);
    store.actions.close(key, third.path);
    assert.equal(store.getView(key).activePath, first.path);
    store.actions.close(key, first.path);
    assert.equal(store.getView(key).activePath, undefined);
    assert.deepEqual(store.getView(key).history, []);
    assert.equal(controller.getView(key).activeTab, "files");
    assert.equal(controller.getView(key).expanded, true);
  });

  test("closing an inactive file preserves the active file and visible panel", () => {
    const controller = createWorkbenchController();
    const store = createFileTabStore(controller);
    store.actions.open(key, first);
    store.actions.open(key, second);
    controller.actions.openTab(key, "browser");
    store.actions.close(key, first.path);
    assert.equal(store.getView(key).activePath, second.path);
    assert.equal(controller.getView(key).activeTab, "browser");
  });

  test("back and forward restore file and line, and a new visit cuts the forward branch", () => {
    const controller = createWorkbenchController();
    const store = createFileTabStore(controller);
    store.actions.back(key);
    store.actions.forward(key);
    assert.equal(store.getView(key).activePath, undefined);
    store.actions.open(key, { ...first, line: 10 });
    store.actions.open(key, { ...first, line: 20 });
    store.actions.open(key, second);
    controller.actions.openTab(key, "changes");
    store.actions.back(key);
    assert.equal(controller.getView(key).activeTab, "files");
    assert.equal(store.getView(key).activePath, first.path);
    assert.equal(store.getView(key).tabs[0]?.line, 20);
    store.actions.back(key);
    assert.equal(store.getView(key).tabs[0]?.line, 10);
    store.actions.back(key);
    assert.equal(store.getView(key).tabs[0]?.line, 10);
    store.actions.forward(key);
    assert.equal(store.getView(key).tabs[0]?.line, 20);
    store.actions.open(key, third);
    store.actions.forward(key);
    assert.equal(store.getView(key).activePath, third.path);
    assert.deepEqual(
      store.getView(key).history.map((entry) => entry.path),
      [first.path, first.path, third.path],
    );
  });

  test("repeated line jumps notify navigation without duplicating history", () => {
    const store = createFileTabStore(createWorkbenchController());
    store.actions.open(key, { ...first, line: 8 });
    const revision = store.getView(key).navigationRevision;
    store.actions.open(key, { ...first, line: 8 });
    assert.equal(store.getView(key).history.length, 1);
    assert.ok(store.getView(key).navigationRevision > revision);
  });

  test("previews replace clean previews and history can reopen a replaced file", () => {
    const store = createFileTabStore(createWorkbenchController());
    store.actions.open(key, { ...first, preview: true, line: 4 });
    store.actions.open(key, { ...second, preview: true });
    assert.deepEqual(
      store.getView(key).tabs.map((tab) => tab.path),
      [second.path],
    );
    store.actions.back(key);
    assert.equal(store.getView(key).activePath, first.path);
    assert.equal(store.getView(key).tabs.find((tab) => tab.path === first.path)?.line, 4);
    store.actions.forward(key);
    assert.equal(store.getView(key).activePath, second.path);
  });

  test("editing, pinning and explicit opening keep previews from being replaced", () => {
    const store = createFileTabStore(createWorkbenchController());
    store.actions.open(key, { ...first, preview: true });
    store.actions.setDraft(key, first.path, {
      contents: "keep me",
      savedContents: "disk",
      version: "v1",
    });
    store.actions.open(key, { ...second, preview: true });
    store.actions.pin(key, second.path);
    store.actions.open(key, { ...third, preview: true });
    store.actions.open(key, third);
    store.actions.open(key, { path: "/workspace/d.ts", displayPath: "d.ts", preview: true });
    assert.equal(store.getView(key).tabs.length, 4);
    assert.equal(store.getView(key).tabs[0]?.draft?.contents, "keep me");
    assert.deepEqual(
      store.getView(key).tabs.map((tab) => tab.preview),
      [false, false, false, true],
    );
  });
});

test("a pending save cannot be discarded by closing its tab", () => {
  const store = createFileTabStore(createWorkbenchController());
  store.actions.open(key, first);
  store.actions.setDraft(key, first.path, {
    contents: "draft",
    savedContents: "disk",
    version: "v1",
  });
  store.actions.setSaving(key, first.path, true);
  assert.equal(store.actions.close(key, first.path), false);
  store.actions.discardClose(key);
  assert.equal(store.getView(key).tabs.length, 1);
  store.actions.setSaving(key, first.path, false);
  store.actions.discardClose(key);
  assert.equal(store.getView(key).tabs.length, 0);
});

test("draft retention carries the disk baseline, not just edited text", () => {
  const store = createFileTabStore(createWorkbenchController());
  store.actions.open(key, first);
  store.actions.setDraft(key, first.path, {
    contents: "draft",
    savedContents: "original",
    version: "original-version",
  });
  store.actions.open(key, second);
  store.actions.select(key, first.path);
  assert.equal(store.getView(key).tabs[0]?.draft?.version, "original-version");
  assert.equal(store.getView(key).tabs[0]?.draft?.savedContents, "original");
  store.actions.setDraft(key, first.path, {
    contents: "draft",
    savedContents: "acknowledged",
    version: "saved-version",
  });
  assert.equal(store.getView(key).tabs[0]?.draft?.version, "saved-version");
});

test("search history distinguishes matches on the same line", () => {
  const store = createFileTabStore(createWorkbenchController());
  store.actions.open(key, { ...first, line: 5, column: 2, length: 3 });
  store.actions.open(key, { ...first, line: 5, column: 12, length: 3 });
  store.actions.back(key);
  assert.equal(store.getView(key).tabs[0]?.column, 2);
  store.actions.forward(key);
  assert.equal(store.getView(key).tabs[0]?.column, 12);
});

test("selecting a tab does not replay its previous search reveal", () => {
  const store = createFileTabStore(createWorkbenchController());
  store.actions.open(key, { ...first, line: 450 });
  const reveal = store.getView(key).tabs[0]?.navigationRevision;
  store.actions.open(key, second);
  store.actions.select(key, first.path);
  assert.equal(store.getView(key).tabs[0]?.navigationRevision, reveal);
  store.actions.open(key, { ...first, line: 450 });
  assert.notEqual(store.getView(key).tabs[0]?.navigationRevision, reveal);
});
