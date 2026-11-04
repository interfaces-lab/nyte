import { asId } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import type { Layout, Pane } from "../panes/layout.ts";
import type { PaneContent } from "../panes/pane-kinds.ts";
import { chatContent } from "../panes/pane-layout.ts";
import type { PaneSelection } from "../panes/pane-layout.ts";
import { parseStrip, storeStrip } from "./stored-strip.ts";

const alpha: PaneSelection = { kind: "session", sessionId: asId<"session">("alpha") };

const beta: PaneSelection = { kind: "session", sessionId: asId<"session">("beta") };

const blank: PaneSelection = { kind: "blank" };

function pane(id: string, selection: PaneSelection): Pane<PaneContent> {
  const tab = asId<"pane-tab">(`${id}-chat`);

  return {
    kind: "pane",
    id: asId<"pane">(id),
    tabs: [{ id: tab, content: chatContent(selection) }],
    active: tab,
    hidden: false,
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
    layout: { root: pane("secondary", alpha), focus: [asId<"pane">("secondary")], zoomed: null },
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
          { node: pane("secondary", beta), size: { kind: "share", share: 0.3 } },
          { node: pane("primary", alpha), size: { kind: "share", share: 0.7 } },
        ],
      },
      focus: [asId<"pane">("primary"), asId<"pane">("secondary")],
      zoomed: null,
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
          { node: pane("primary", alpha), size: { kind: "share", share: 0.3 } },
          { node: pane("secondary", blank), size: { kind: "share", share: 0.7 } },
        ],
      },
      focus: [asId<"pane">("primary"), asId<"pane">("secondary")],
      zoomed: null,
    },
  },
  {
    name: "a split showing one chat twice becomes its focused pane",
    stored: { ...split, secondary: alpha, activePaneId: "secondary" },
    layout: { root: pane("secondary", alpha), focus: [asId<"pane">("secondary")], zoomed: null },
  },
])("version 2: $name, and saves as version 3", ({ stored, layout }) => {
  const restored = parseStrip(version2(stored), () => "unused");
  expect(restored?.tabs[0]?.view).toEqual({ kind: "panes", layout });

  if (restored === undefined) return;
  const saved = storeStrip(restored);
  expect(saved.version).toBe(3);
  expect(parseStrip(JSON.parse(JSON.stringify(saved)), () => "unused")).toEqual(restored);
});
