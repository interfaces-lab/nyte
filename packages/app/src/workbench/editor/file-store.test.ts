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
    store.actions.open(key, { ...first, line: 12 });

    const tabs = store.getView(key).tabs;
    assert.equal(tabs.length, 2);
    assert.equal(tabs[0]?.line, 12);
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

  test("history restores file locations without owning tab activation", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    store.actions.open(key, { ...first, line: 10 });
    store.actions.open(key, { ...first, line: 20 });
    store.actions.open(key, second);
    store.actions.back(key);
    assert.equal(store.getView(key).active?.path, first.path);
    assert.equal(store.getView(key).tabs[0]?.line, 20);
    store.actions.back(key);
    assert.equal(store.getView(key).tabs[0]?.line, 10);
  });

  test("opening a file at a line publishes once, with the tab and its line together", () => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const store = createFileTabStore(workbench);
    store.actions.open(key, first);
    const seen: [string | undefined, number | undefined][] = [];

    const unsubscribe = store.subscribe(() => {
      const active = store.getView(key).active;
      seen.push([active?.path, active?.line]);
    });

    store.actions.open(key, { ...second, line: 5, preview: true });
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
