import { expect, test } from "vitest";
import type { StorageArea } from "../lib/storage.ts";
import { FIRST_GROUP } from "./model.ts";
import { createFileTabStore } from "./editor/file-store.ts";
import { persistable, workbenchPersistence } from "./persistence.ts";
import { createWorkbenchStore } from "./store.ts";

const KEY = "nyte:desktop:workbench:v7";

function memoryArea(raw: string | null) {
  const values = new Map(raw === null ? [] : [[KEY, raw]]);
  const writes: { key: string; value: string }[] = [];

  const area: StorageArea = {
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      values.set(key, value);
      writes.push({ key, value });
    },
    removeItem(key) {
      values.delete(key);
    },
  };

  return { area, writes };
}

function snapshot(version: 7 | 8, kind: "files" | "editor", active: string) {
  return {
    version,
    views: [
      {
        key: "/workspace",
        tabs: [
          { id: "files", kind },
          { id: "document-1", kind: "file", path: "/workspace/notes.md", preview: false },
          { id: "document-2", kind: "file", path: "/workspace/src/main.ts", preview: true },
          {
            id: "canvas-1",
            kind: "canvas",
            sessionId: "session-1",
            part: "part-1",
            title: "Sketch",
            pinned: 2,
          },
          { id: "browser-1", kind: "browser", url: "https://nyte.sh" },
          { id: "terminal-1", kind: "terminal", owner: { kind: "user" } },
          {
            id: "changes-1",
            kind: "changes",
            scope: { kind: "staged" },
            selectedPath: "src/main.ts",
            pathRevealRevision: 2,
            scrollTop: 80,
          },
        ],
        active,
        expanded: true,
        maximized: true,
        width: 640,
      },
      {
        key: "/other-workspace",
        tabs: [{ id: "other-editor", kind }],
        active: "other-editor",
        expanded: false,
        maximized: false,
      },
    ],
  };
}

test.each([
  { version: 7, kind: "files", active: "files", writes: 1 },
  { version: 7, kind: "files", active: "document-1", writes: 1 },
  { version: 8, kind: "editor", active: "files", writes: 0 },
  { version: 8, kind: "editor", active: "document-1", writes: 0 },
] as const)(
  "v$version restores $active without changing identities, documents or layout",
  (row) => {
    const storage = memoryArea(JSON.stringify(snapshot(row.version, row.kind, row.active)));
    const persistence = workbenchPersistence(storage.area);
    const expected = snapshot(8, "editor", row.active);

    expect(persistence.get()).toEqual(expected);
    expect(persistence.get()).toEqual(expected);
    expect(storage.writes).toHaveLength(row.writes);
    expect(storage.area.getItem(KEY)).toBe(JSON.stringify(expected));

    const reopened = workbenchPersistence(storage.area);
    const store = createWorkbenchStore(() => ({ browser: true }), reopened);
    const view = store.getView("/workspace");

    expect(view).toMatchObject({
      active: row.active,
      tabs: [
        { id: "files", kind: "editor" },
        { id: "document-1", kind: "file", path: "/workspace/notes.md", preview: false },
        { id: "document-2", kind: "file", path: "/workspace/src/main.ts", preview: true },
        {
          id: "canvas-1",
          kind: "canvas",
          sessionId: "session-1",
          part: "part-1",
          title: "Sketch",
          pinned: 2,
        },
        { id: "browser-1", kind: "browser", url: "https://nyte.sh", surface: null },
        { id: "terminal-1", kind: "terminal", owner: { kind: "user" } },
        {
          id: "changes-1",
          kind: "changes",
          scope: { kind: "staged" },
          selectedPath: "src/main.ts",
          pathRevealRevision: 2,
          scrollTop: 80,
        },
      ],
      groups: [{ id: FIRST_GROUP, active: row.active === "document-1" ? "document-1" : null }],
      expanded: true,
      layout: { kind: "maximized" },
      width: { pixels: 640 },
    });
    expect(store.getView("/other-workspace")).toMatchObject({
      active: "other-editor",
      tabs: [{ id: "other-editor", kind: "editor" }],
      expanded: false,
      layout: { kind: "split" },
    });
    expect(storage.writes).toHaveLength(row.writes);
    expect(storage.area.getItem(KEY)).toBe(JSON.stringify(expected));
    expect(createFileTabStore(store).getView("/workspace").active?.id).toBe("document-1");

    store.dispatch("/workspace", {
      kind: "open",
      tab: { id: "new-editor", kind: "editor" },
      activate: true,
    });
    expect(store.getView("/workspace")).toMatchObject({ active: "document-1", tabs: view.tabs });

    const written = persistable(store.getSnapshot());
    persistence.set(written);
    expect(written).toMatchObject({ version: 8 });
    expect(workbenchPersistence(storage.area).get()).toEqual(written);
    expect(storage.writes.at(-1)).toEqual({ key: KEY, value: JSON.stringify(written) });
  },
);

test.each([
  { name: "missing", raw: null },
  { name: "malformed JSON", raw: "{" },
  { name: "v7 with an Editor tab", raw: JSON.stringify(snapshot(7, "editor", "files")) },
  { name: "v8 with a Files tab", raw: JSON.stringify(snapshot(8, "files", "files")) },
  {
    name: "a strict tab with an unknown field",
    raw: JSON.stringify({
      version: 7,
      views: [
        {
          key: "/workspace",
          tabs: [{ id: "files", kind: "files", unexpected: true }],
          active: "files",
          expanded: true,
          maximized: false,
        },
      ],
    }),
  },
])("$name is not rewritten, and a later valid write can be reopened", (row) => {
  const storage = memoryArea(row.raw);
  const persistence = workbenchPersistence(storage.area);

  expect(persistence.get()).toBeUndefined();
  expect(storage.area.getItem(KEY)).toBe(row.raw);
  expect(storage.writes).toEqual([]);

  persistence.set({ version: 8, views: [] });
  expect(workbenchPersistence(storage.area).get()).toEqual({ version: 8, views: [] });
});
