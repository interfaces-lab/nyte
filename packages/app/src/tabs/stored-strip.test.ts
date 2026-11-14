import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { layoutPanes } from "../panes/layout.ts";
import type { Layout, Pane } from "../panes/layout.ts";
import type { PaneContent } from "../panes/pane-kinds.ts";
import { chatContent } from "../panes/pane-layout.ts";
import type { PaneSelection } from "../panes/pane-layout.ts";
import { parseStrip, storeStrip } from "./stored-strip.ts";

const alpha: PaneSelection = { kind: "session", sessionId: asId<"session">("alpha") };

const beta: PaneSelection = { kind: "session", sessionId: asId<"session">("beta") };

const blank: PaneSelection = { kind: "blank" };

function pane(id: string, selection: PaneSelection): Pane<PaneContent> {
  return {
    kind: "pane",
    id: asId<"pane">(id),
    tab: { id: asId<"pane-tab">(`${id}-chat`), content: chatContent(selection) },
  };
}

function version2(layout: object) {
  return {
    version: 2,
    tabs: [{ id: "tab", view: { kind: "panes", layout } }],
    activeTabId: "tab",
    recent: [],
    closed: [],
  };
}

const split = {
  kind: "split",
  direction: "right",
  ratio: 0.3,
  leading: "secondary",
  primary: alpha,
  secondary: beta,
  activePaneId: "primary",
} as const;

test.each<{
  readonly name: string;
  readonly stored: object;
  readonly layout: Layout<PaneContent>;
}>([
  {
    name: "a single pane keeps its id",
    stored: { kind: "single", paneId: "secondary", selection: alpha },
    layout: { root: pane("secondary", alpha), focus: [asId<"pane">("secondary")] },
  },
  {
    name: "a split keeps its direction, order, ratio and focus",
    stored: split,
    layout: {
      root: {
        kind: "split",
        id: asId<"split">("split"),
        direction: "right",
        children: [
          { node: pane("secondary", beta), size: 0.3 },
          { node: pane("primary", alpha), size: 0.7 },
        ],
      },
      focus: [asId<"pane">("primary"), asId<"pane">("secondary")],
    },
  },
  {
    name: "a split down with a new chat",
    stored: { ...split, direction: "down", leading: "primary", secondary: blank },
    layout: {
      root: {
        kind: "split",
        id: asId<"split">("split"),
        direction: "down",
        children: [
          { node: pane("primary", alpha), size: 0.3 },
          { node: pane("secondary", blank), size: 0.7 },
        ],
      },
      focus: [asId<"pane">("primary"), asId<"pane">("secondary")],
    },
  },
  {
    name: "a split showing one chat twice becomes its focused pane",
    stored: { ...split, secondary: alpha, activePaneId: "secondary" },
    layout: { root: pane("secondary", alpha), focus: [asId<"pane">("secondary")] },
  },
])("version 2: $name, and saves as version 3", ({ stored, layout }) => {
  const restored = parseStrip(version2(stored), () => "unused");
  expect(restored?.tabs[0]?.view).toEqual({ kind: "panes", layout });

  if (restored === undefined) return;
  const saved = storeStrip(restored);
  expect(saved.version).toBe(3);
  expect(parseStrip(JSON.parse(JSON.stringify(saved)), () => "unused")).toEqual(restored);
});

function chatTab(id: string, ...selections: readonly PaneSelection[]) {
  const panes = selections.map((selection, index) => pane(`${id}-${String(index)}`, selection));
  const first = panes[0];
  const second = panes[1];

  if (first === undefined) throw new Error("A tab shows a pane");

  const root: Layout<PaneContent>["root"] =
    second === undefined
      ? first
      : {
          kind: "split",
          id: asId<"split">(`${id}-split`),
          direction: "right",
          children: [
            { node: first, size: 1 },
            { node: second, size: 1 },
          ],
        };

  return { id, view: { kind: "panes" as const, layout: { root, focus: [first.id] } } } as const;
}

test.each<{
  readonly name: string;
  readonly stored: object;
  readonly tabs: readonly (readonly [string, readonly string[]])[];
  readonly active: string;
}>([
  {
    name: "a chat saved in two tabs stays in the active one",
    stored: storeStrip({
      tabs: [chatTab("one", alpha), chatTab("two", alpha)],
      activeTabId: "two",
      recent: ["one"],
      closed: [],
      hidden: [],
    }),
    tabs: [["two", ["alpha"]]],
    active: "two",
  },
  {
    name: "a split keeps its other chat",
    stored: storeStrip({
      tabs: [chatTab("one", beta, alpha), chatTab("two", alpha)],
      activeTabId: "two",
      recent: ["one"],
      closed: [],
      hidden: [],
    }),
    tabs: [
      ["one", ["beta"]],
      ["two", ["alpha"]],
    ],
    active: "two",
  },
  {
    name: "a chat the active tab does not show stays in the tab looked at last",
    stored: storeStrip({
      tabs: [chatTab("one", beta), chatTab("two", alpha), chatTab("three", alpha)],
      activeTabId: "one",
      recent: ["three", "two"],
      closed: [],
      hidden: [],
    }),
    tabs: [
      ["one", ["beta"]],
      ["three", ["alpha"]],
    ],
    active: "one",
  },
  {
    name: "a version 2 window with a chat in two tabs",
    stored: {
      ...version2({ kind: "single", paneId: "primary", selection: alpha }),
      tabs: ["one", "two"].map((id) => ({
        id,
        view: { kind: "panes", layout: { kind: "single", paneId: "primary", selection: alpha } },
      })),
      activeTabId: "one",
    },
    tabs: [["one", ["alpha"]]],
    active: "one",
  },
])("a saved window: $name", ({ stored, tabs, active }) => {
  const restored = parseStrip(JSON.parse(JSON.stringify(stored)), () => "unused");

  expect(
    restored?.tabs.map((tab) => [
      tab.id,
      tab.view.kind === "page"
        ? []
        : layoutPanes(tab.view.layout.root).map((shown) =>
            shown.tab.content.fields.selection.kind === "session"
              ? shown.tab.content.fields.selection.sessionId
              : "blank",
          ),
    ]),
  ).toEqual(tabs);
  expect(restored?.activeTabId).toBe(active);
});
