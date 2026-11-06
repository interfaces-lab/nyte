import { expect, test } from "vitest";
import { DEFAULT_VIEW } from "./model.ts";
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
  expect(workbenchPanelWidth(store.getView(view).width, 696)).toBe(588);

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
      version: 7,
      views: [
        {
          key: "/workspace",
          tabs: [{ id: "files", kind: "files" }],
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
  expect(store.getView("/workspace").tabs).toMatchObject([{ id: "files", kind: "files" }]);
  store.dispatch("/workspace", { kind: "set-width", pixels: 640 });
  expect(workbenchPanelWidth(store.getView("/workspace").width, 2000)).toBe(640);
});
