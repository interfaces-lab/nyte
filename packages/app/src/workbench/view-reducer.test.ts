import { expect, test } from "vitest";
import { DEFAULT_VIEW, EDITOR_SLOT } from "./model.ts";
import { workbenchStripTabs } from "./selectors.ts";
import { createFileTabStore } from "./editor/file-store.ts";
import type { WorkbenchPersistence } from "./persistence.ts";
import { createWorkbenchStore } from "./store.ts";
import { reduceView } from "./view-reducer.ts";
import { workbenchPanelWidth } from "./width.ts";

test("reopening Changes applies the requested scope and path to the open tab in one step", () => {
  const opened = reduceView(DEFAULT_VIEW, {
    kind: "open-changes",
    id: "first",
    scope: { kind: "uncommitted" },
    path: null,
  });

  const scrolled = reduceView(opened, {
    kind: "patch",
    id: "first",
    change: { kind: "changes", patch: { scrollTop: 30 } },
  });

  const reopened = reduceView(scrolled, {
    kind: "open-changes",
    id: "second",
    scope: { kind: "thread" },
    path: "src/last.ts",
  });

  expect(reopened).toMatchObject({
    active: "first",
    expanded: true,
    tabs: [
      {
        id: "first",
        kind: "changes",
        scope: { kind: "thread" },
        selectedPath: "src/last.ts",
        pathRevealRevision: 1,
        scrollTop: 0,
      },
    ],
  });
});

test("the strip projects one Editor entry and reorders it without changing file order or selection", () => {
  const workbench = createWorkbenchStore(() => ({ browser: true }));
  const files = createFileTabStore(workbench);
  const key = "/workspace";
  files.actions.open(key, { path: "/workspace/first.ts", preview: true });
  workbench.dispatch(key, {
    kind: "open-changes",
    id: "changes",
    scope: { kind: "uncommitted" },
    path: null,
  });
  files.actions.open(key, { path: "/workspace/second.ts" });
  files.actions.split(key, "after");
  workbench.dispatch(key, {
    kind: "open",
    tab: { kind: "editor", id: "launcher" },
    activate: false,
  });
  const before = files.getView(key);

  const entries = workbenchStripTabs(
    workbench.getView(key),
    { kind: "project" },
    { browser: true },
  );

  expect(entries.map((tab) => tab.id)).toEqual([EDITOR_SLOT, "changes"]);
  const editor = entries[0];
  expect(editor).toMatchObject({ kind: "editor", target: before.active?.id });

  workbench.dispatch(key, { kind: "move-slot", slot: EDITOR_SLOT, before: null });
  expect(
    workbenchStripTabs(workbench.getView(key), { kind: "project" }, { browser: true }).map(
      (tab) => tab.id,
    ),
  ).toEqual(["changes", EDITOR_SLOT]);
  expect(files.getView(key).tabs.map((tab) => tab.id)).toEqual(before.tabs.map((tab) => tab.id));
  expect(files.getView(key).active?.id).toBe(before.active?.id);
  workbench.dispatch(key, { kind: "activate", id: "changes" });
  workbench.dispatch(key, { kind: "activate", id: "launcher" });
  expect(files.getView(key).active?.id).toBe(before.active?.id);
  expect(workbench.getView(key).active).toBe(before.active?.id);
  expect(files.getView(key).tabs[0]?.preview).toBe(true);
});

test.each([
  { scope: { kind: "project" } as const, expected: [EDITOR_SLOT, "terminal"] },
  { scope: { kind: "pathless" } as const, expected: ["terminal"] },
])("the Editor strip projection respects the $scope.kind scope", (row) => {
  const state = reduceView(
    reduceView(DEFAULT_VIEW, {
      kind: "open-file",
      tab: { id: "file", kind: "file", path: "/workspace/file.ts", group: "first", preview: false },
      replace: undefined,
    }),
    { kind: "add", tab: { id: "terminal", kind: "terminal", owner: { kind: "user" } } },
  );

  expect(workbenchStripTabs(state, row.scope, { browser: false }).map((tab) => tab.id)).toEqual(
    row.expected,
  );
});

test.each([false, true])(
  "closing the last file keeps Editor only when it was explicitly launched: %s",
  (launched) => {
    const workbench = createWorkbenchStore(() => ({ browser: true }));
    const files = createFileTabStore(workbench);
    const key = "/workspace";
    files.actions.open(key, { path: "/workspace/file.ts" });
    files.actions.split(key, "after");

    if (launched)
      workbench.dispatch(key, {
        kind: "open",
        tab: { kind: "editor", id: "launcher" },
        activate: true,
      });

    for (const tab of files.getView(key).tabs) files.actions.close(key, tab.id);

    expect(
      workbenchStripTabs(workbench.getView(key), { kind: "project" }, { browser: true }),
    ).toEqual(launched ? [{ kind: "editor", id: EDITOR_SLOT, target: "launcher" }] : []);
    expect(files.getView(key).active).toBeUndefined();
    expect(files.getView(key).groups).toHaveLength(1);
  },
);

test("the panel keeps its preferred pixel width as the stage changes", () => {
  const stored: Parameters<WorkbenchPersistence["set"]>[0][] = [];

  const store = createWorkbenchStore(() => ({ browser: true }), {
    get: () => undefined,
    set: (value) => {
      stored.push(value);
    },
  });

  const view = "/workspace";

  expect(workbenchPanelWidth(store.getView(view).width, 1176)).toBe(588);
  expect(workbenchPanelWidth(store.getView(view).width, 1424)).toBe(588);
  expect(workbenchPanelWidth(store.getView(view).width, 944)).toBe(520);
  expect(workbenchPanelWidth(store.getView(view).width, 696)).toBe(384);

  store.dispatch(view, { kind: "set-width", pixels: 700 });
  expect(workbenchPanelWidth(store.getView(view).width, 944)).toBe(520);
  expect(workbenchPanelWidth(store.getView(view).width, 2000)).toBe(700);
  expect(stored.at(-1)?.views).toMatchObject([{ key: view, width: 700 }]);

  const reopened = createWorkbenchStore(() => ({ browser: true }), {
    get: () => stored.at(-1),
    set: () => undefined,
  });

  expect(workbenchPanelWidth(reopened.getView(view).width, 2000)).toBe(700);
});

test.each([
  { width: 520, share: undefined, expected: 520 },
  { width: 400, share: undefined, expected: 400 },
  { width: undefined, share: 0.5, expected: 588 },
])("restored panel width $width with share $share resolves to $expected pixels", (row) => {
  const store = createWorkbenchStore(() => ({ browser: true }), {
    get: () => ({
      version: 8,
      views: [
        {
          key: "/workspace",
          tabs: [{ id: "files", kind: "editor" }],
          active: "files",
          expanded: true,
          maximized: false,
          width: row.width,
          share: row.share,
        },
      ],
    }),
    set: () => undefined,
  });

  expect(workbenchPanelWidth(store.getView("/workspace").width, 1400)).toBe(row.expected);
  expect(workbenchPanelWidth(store.getView("/workspace").width, 2000)).toBe(row.expected);
  expect(store.getView("/workspace").tabs).toMatchObject([{ id: "files", kind: "editor" }]);
  store.dispatch("/workspace", { kind: "set-width", pixels: 640 });
  expect(workbenchPanelWidth(store.getView("/workspace").width, 2000)).toBe(640);
});
