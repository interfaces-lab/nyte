import assert from "node:assert/strict";
import type { FileDocument } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { QueryClient } from "@tanstack/react-query";
import { describe, test } from "vitest";
import { keys } from "../../data/query-client.ts";
import { workbenchViewKey } from "../paths.ts";
import { createWorkbenchStore } from "../store.ts";
import { createFileTabStore } from "./file-store.ts";

const first = { path: "/workspace/src/a.ts" };

const second = { path: "/workspace/src/b.ts" };

const third = { path: "/workspace/src/c.ts" };

const key = workbenchViewKey("/workspace");

describe("file runtime store", () => {
  test("documents use workbench tab IDs while order and activation stay in the workbench store", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);

    const changes = "changes";
    workbench.dispatch(key, {
      kind: "open-changes",
      id: changes,
      scope: { kind: "uncommitted" },
      path: null,
    });

    store.actions.open(key, first);
    store.actions.open(key, second);
    store.actions.open(key, { ...first, target: { kind: "position", line: 12 } });

    const tabs = store.getView(key).tabs;
    assert.equal(tabs.length, 2);
    assert.deepEqual(tabs[0]?.target, { kind: "position", line: 12 });
    assert.equal(store.getView(key).active?.path, first.path);
    assert.deepEqual(
      workbench.getView(key).tabs.map((tab) => tab.kind),
      ["changes", "file", "file"],
    );
    assert.equal(workbench.getView(key).tabs[0]?.id, changes);
    assert.equal(workbench.getView(key).active, tabs[0]?.id);
  });

  test("drafts survive tab switches and stay apart between workspaces", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    const other = workbenchViewKey("/other-workspace");
    store.actions.open(key, first);
    store.actions.setDraft(key, first.path, {
      contents: "unsaved",
      savedContents: "disk",
      version: asId<"file-version">("v1"),
    });
    store.actions.open(key, second);
    store.actions.open(other, first);
    store.actions.setDraft(other, first.path, {
      contents: "other draft",
      savedContents: "disk",
      version: asId<"file-version">("v1"),
    });

    assert.equal(store.getView(key).tabs[0]?.draft?.contents, "unsaved");
    assert.equal(store.getView(other).tabs[0]?.draft?.contents, "other draft");
    assert.notEqual(store.getView(key).tabs[0]?.id, store.getView(other).tabs[0]?.id);
  });

  test("dirty close retains the workbench tab until explicit discard", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    store.actions.open(key, first);
    store.actions.setDraft(key, first.path, {
      contents: "unsaved",
      savedContents: "disk",
      version: asId<"file-version">("v1"),
    });

    const id = store.getView(key).tabs[0]?.id ?? "";
    assert.equal(store.actions.close(key, id), false);
    assert.equal(workbench.getView(key).tabs.length, 1);
    store.actions.cancelClose(key);
    assert.equal(store.getView(key).tabs[0]?.draft?.contents, "unsaved");
    store.actions.close(key, id);
    store.actions.discardClose(key);
    assert.equal(workbench.getView(key).tabs.length, 0);
  });

  test("unsaved closes wait in request order and cancel keeps the remaining drafts", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);

    for (const location of [first, second, third]) {
      store.actions.open(key, location);
      store.actions.setDraft(key, location.path, {
        contents: location.path,
        savedContents: "disk",
        version: asId<"file-version">("v1"),
      });
    }

    const tabs = store.getView(key).tabs;
    const a = tabs[0];
    const b = tabs[1];
    const c = tabs[2];
    assert.ok(a !== undefined && b !== undefined && c !== undefined);

    for (const tab of tabs) assert.equal(store.actions.close(key, tab.id), false);
    store.actions.close(key, b.id);
    assert.equal(store.getView(key).pendingClose?.id, a.id);
    store.actions.discardClose(key);
    assert.equal(store.getView(key).pendingClose?.id, b.id);
    assert.deepEqual(
      store.getView(key).tabs.map((tab) => tab.id),
      [b.id, c.id],
    );
    store.actions.cancelClose(key);
    assert.equal(store.getView(key).pendingClose, undefined);
    assert.deepEqual(
      store.getView(key).tabs.map((tab) => tab.draft?.contents),
      [second.path, third.path],
    );
  });

  test("groups retain their selected file while another workbench panel is active", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    store.actions.open(key, first);
    const id = store.getView(key).active?.id;
    workbench.dispatch(key, {
      kind: "open-changes",
      id: "changes",
      scope: { kind: "uncommitted" },
      path: null,
    });
    assert.equal(store.getView(key).groups[0]?.active?.id, id);
  });

  test("splitting an unfocused file places the new group beside its source group", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    store.actions.open(key, first);
    store.actions.split(key, "after");
    const source = store.getView(key).active;
    assert.ok(source !== undefined);
    store.actions.split(key, "after");
    const last = store.getView(key).active;
    const original = store.getView(key).groups[0];
    assert.ok(last !== undefined && original !== undefined);
    store.actions.focusGroup(key, original.id);
    store.actions.split(key, "after", source.id);
    assert.deepEqual(
      store.getView(key).groups.map((group) => group.id),
      [original.id, source.group, store.getView(key).group, last.group],
    );
  });

  test("clean previews replace each other while pinned files remain", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    store.actions.open(key, { ...first, preview: true });
    store.actions.open(key, { ...second, preview: true });
    store.actions.pin(key, store.getView(key).tabs[0]?.id ?? "");
    store.actions.open(key, { ...third, preview: true });

    assert.deepEqual(
      store.getView(key).tabs.map((tab) => [tab.path, tab.preview]),
      [
        [second.path, false],
        [third.path, true],
      ],
    );
  });

  test("Close Group keeps one confirmation queue and does not discard another group's shared draft", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);

    for (const location of [first, second, third]) {
      store.actions.open(key, location);
      store.actions.setDraft(key, location.path, {
        contents: location.path,
        savedContents: "disk",
        version: asId<"file-version">("v1"),
      });
    }

    const group = store.getView(key).group;
    const shared = store.getView(key).tabs[0];
    const b = store.getView(key).tabs[1];
    const c = store.getView(key).tabs[2];
    assert.ok(shared !== undefined && b !== undefined && c !== undefined);
    store.actions.split(key, "after", shared.id);
    const other = store.getView(key).group;
    store.actions.setSaving(key, third.path, true);
    assert.equal(store.actions.closeGroup(key, group), false);
    assert.equal(store.actions.closeGroup(key, group), false);
    assert.equal(store.getView(key).pendingClose?.id, b.id);
    assert.equal(
      store.getView(key).tabs.some((tab) => tab.id === shared.id),
      false,
    );
    store.actions.discardClose(key);
    assert.equal(store.getView(key).pendingClose?.id, c.id);
    store.actions.discardClose(key);
    assert.equal(store.getView(key).pendingClose?.id, c.id);
    store.actions.setSaving(key, third.path, false);
    store.actions.cancelClose(key);
    assert.equal(store.getView(key).pendingClose, undefined);
    assert.equal(
      store.getView(key).tabs.find((tab) => tab.id === c.id)?.draft?.contents,
      third.path,
    );
    store.actions.closeGroup(key, group);
    store.actions.discardClose(key);
    assert.deepEqual(
      store.getView(key).groups.map((entry) => entry.id),
      [other],
    );
    assert.equal(store.getView(key).active?.draft?.contents, first.path);
  });

  test("queued files that finish saving close without a second discard confirmation", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);

    for (const location of [first, second]) {
      store.actions.open(key, location);
      store.actions.setDraft(key, location.path, {
        contents: "draft",
        savedContents: "disk",
        version: asId<"file-version">("v1"),
      });
    }

    store.actions.closeGroup(key, store.getView(key).group);
    store.actions.setSaving(key, second.path, true);
    store.actions.setDraft(key, second.path, undefined);
    store.actions.discardClose(key);
    assert.equal(store.getView(key).pendingClose?.path, second.path);
    store.actions.setSaving(key, second.path, false);
    assert.equal(store.getView(key).pendingClose, undefined);
    assert.equal(store.getView(key).tabs.length, 0);
  });

  test("row placement reorders tabs and inserts tree files without duplicating repeated drops", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);

    for (const location of [first, second, third]) store.actions.open(key, location);
    const a = store.getView(key).tabs[0];
    const c = store.getView(key).tabs[2];
    assert.ok(a !== undefined && c !== undefined);
    const before = { kind: "tabs", group: a.group, before: c.id } as const;
    store.actions.place(key, { kind: "tab", id: a.id }, before);
    store.actions.place(key, { kind: "tab", id: a.id }, before);
    assert.deepEqual(
      store.getView(key).tabs.map((tab) => tab.path),
      [second.path, first.path, third.path],
    );
    store.actions.place(
      key,
      { kind: "tab", id: a.id },
      { kind: "tabs", group: a.group, before: null },
    );
    assert.deepEqual(
      store.getView(key).tabs.map((tab) => tab.path),
      [second.path, third.path, first.path],
    );
    const tree = { kind: "file", path: "/workspace/src/new.ts" } as const;
    store.actions.place(key, tree, before);
    store.actions.place(key, tree, before);
    assert.deepEqual(
      store.getView(key).tabs.map((tab) => tab.path),
      [second.path, tree.path, third.path, first.path],
    );
    store.actions.split(key, "after", a.id);
    const copy = store.getView(key).active;
    assert.ok(copy !== undefined);
    store.actions.place(
      key,
      { kind: "tab", id: a.id },
      { kind: "tabs", group: copy.group, before: null },
    );
    assert.equal(store.getView(key).tabs.filter((tab) => tab.path === first.path).length, 1);
    assert.equal(store.getView(key).active?.id, copy.id);
  });

  test("tree-file edge drops duplicate the file while tab edge drops move it", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    store.actions.open(key, first);
    const original = store.getView(key).active;
    assert.ok(original !== undefined);
    store.actions.place(
      key,
      { kind: "file", path: first.path },
      { kind: "body", group: original.group, zone: "after" },
    );
    assert.equal(store.getView(key).tabs.length, 2);
    assert.equal(store.getView(key).groups.length, 2);
    const copy = store.getView(key).active;
    assert.ok(copy !== undefined);
    store.actions.place(
      key,
      { kind: "tab", id: copy.id },
      { kind: "body", group: original.group, zone: "before" },
    );
    assert.equal(store.getView(key).tabs.length, 2);
    assert.deepEqual(
      store.getView(key).groups.map((group) => group.active?.id),
      [copy.id, original.id],
    );
  });

  test("history restores file locations without owning tab activation", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    store.actions.open(key, { ...first, target: { kind: "position", line: 10 } });
    store.actions.open(key, { ...first, target: { kind: "position", line: 20 } });
    store.actions.open(key, second);
    store.actions.back(key);
    assert.equal(store.getView(key).active?.path, first.path);
    assert.deepEqual(store.getView(key).tabs[0]?.target, { kind: "position", line: 20 });
    store.actions.back(key);
    assert.deepEqual(store.getView(key).tabs[0]?.target, { kind: "position", line: 10 });
  });

  test("opening a file at a line publishes once, with the tab and its line together", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    store.actions.open(key, first);
    const seen: [string | undefined, number | undefined][] = [];

    const unsubscribe = store.subscribe(() => {
      const active = store.getView(key).active;
      seen.push([
        active?.path,
        active?.target?.kind === "position" ? active.target.line : undefined,
      ]);
    });

    store.actions.open(key, {
      ...second,
      target: { kind: "position", line: 5 },
      preview: true,
    });
    store.actions.back(key);
    unsubscribe();

    assert.deepEqual(seen, [
      [second.path, 5],
      [first.path, undefined],
    ]);
  });

  test("a workspace path the host reads outside the workspace displays as outside once loaded", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const documents = new QueryClient();
    const store = createFileTabStore(workbench, documents);
    const link = "/workspace/link/notes.md";
    store.actions.open(key, { path: link });
    assert.equal(store.getView(key).active?.displayPath, "link/notes.md");
    const seen: [string | undefined, boolean | undefined][] = [];

    const unsubscribe = store.subscribe(() => {
      const active = store.getView(key).active;
      seen.push([active?.displayPath, active?.external]);
    });

    const document: FileDocument = {
      kind: "text",
      path: link,
      scope: "external",
      mime: "text/markdown",
      contents: "",
      version: asId<"file-version">("v1"),
    };

    documents.setQueryData(keys.workspaceFile(link), document);
    unsubscribe();

    assert.deepEqual(seen.at(-1), [link, true]);
  });
});
