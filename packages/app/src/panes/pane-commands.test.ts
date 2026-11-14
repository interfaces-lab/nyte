import type { ClientRect } from "@dnd-kit/core";
import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { PRIMARY, tabPanes } from "../../test/panes.ts";
import { activeTab, layoutPanes } from "./layout.ts";
import type { Layout, LayoutNode, PaneId } from "./layout.ts";
import { dropTarget } from "./pane-commands.ts";
import type { PaneController } from "./pane-controller.ts";
import type { PaneContent } from "./pane-kinds.ts";
import { chatPanes } from "./pane-layout.ts";

const A = asId<"session">("A");

const B = asId<"session">("B");

const C = asId<"session">("C");

type Fixture = (controller: PaneController) => void;

type Command = (controller: PaneController, panes: readonly PaneId[]) => void;

function pane(panes: readonly PaneId[], index: number): PaneId {
  return panes[index] ?? PRIMARY;
}

const blank: Fixture = () => undefined;

const one: Fixture = (controller) => controller.selectSession(A);

const two: Fixture = (controller) => {
  controller.selectSession(A);
  controller.split("right");
  controller.selectSession(B);
};

const six: Fixture = (controller) => {
  controller.selectSession(A);

  for (let split = 0; split < 5; split += 1) controller.split("right");
};

/** Undoes hiding A from [A|B] after `between` ran on the pane A left, expecting `accepted`. */
function unhide(between: Command, accepted: boolean): Command {
  return (controller, panes) => {
    const restore = controller.removeSessionWithUndo(A);
    between(controller, panes);
    expect(restore()).toBe(accepted);
  };
}

function typeInto(controller: PaneController, paneId: PaneId): void {
  const draft = controller.viewState.readBlank(paneId);
  controller.viewState.writeBlank(paneId, {
    ...draft,
    composer: { ...draft.composer, draft: "Keep", selectionStart: 4, selectionEnd: 4 },
  });
}

/**
 * Draws the layout as nested splits of what each pane shows: `right(A,B*)`. A star marks a pane
 * whose shown tab is new since `before`.
 */
function arrangement(node: LayoutNode<PaneContent>, before: Layout<PaneContent>): string {
  if (node.kind === "split")
    return `${node.direction}(${node.children.map((child) => arrangement(child.node, before)).join(",")})`;
  const tab = activeTab(node);

  const kept = layoutPanes(before.root).some((entry) =>
    entry.tabs.some((candidate) => candidate.id === tab.id),
  );

  const label =
    tab.content.kind !== "chat"
      ? tab.content.kind
      : tab.content.fields.selection.kind === "blank"
        ? "blank"
        : tab.content.fields.selection.sessionId;

  return kept ? label : `${label}*`;
}

function label(layout: Layout<PaneContent>, paneId: PaneId | undefined): string | undefined {
  if (paneId === undefined) return undefined;
  const index = chatPanes(layout).findIndex((entry) => entry.pane === paneId);

  return index === -1 ? `missing ${paneId}` : String(index);
}

test.each([
  ["blank + show A", blank, (controller) => controller.selectSession(A), "A*", "0", ["0"]],
  ["A + show A", one, (controller) => controller.selectSession(A), "A", "0", []],
  [
    "[A|B] focus B + show-in(left, B)",
    two,
    (controller, panes) => controller.selectSessionInPane(pane(panes, 0), B),
    "right(A,B)",
    "1",
    [],
  ],
  [
    "[A|B] focus left + show-in(left, C)",
    (controller) => {
      two(controller);
      controller.focus(
        pane(
          chatPanes(controller.getSnapshot()).map((entry) => entry.pane),
          0,
        ),
      );
    },
    (controller, panes) => controller.selectSessionInPane(pane(panes, 0), C),
    "right(C,B)",
    "0",
    ["0"],
  ],
  ["[A] + close", one, (controller) => controller.close(PRIMARY), "blank", "0", ["0"]],
  [
    "[A|B] + close(left)",
    two,
    (controller, panes) => controller.close(pane(panes, 0)),
    "B",
    "0",
    ["0"],
  ],
  [
    "[A] + split right",
    one,
    (controller) => controller.split("right"),
    "right(A,blank*)",
    "1",
    ["1"],
  ],
  [
    "6 panes + split",
    six,
    (controller) => controller.split("right"),
    "right(A,blank,blank,blank,blank,blank)",
    "5",
    [],
  ],
  [
    "[A|B] + drop(B, left, center)",
    two,
    (controller, panes) => controller.drop(B, pane(panes, 0), "center"),
    "right(B,A)",
    "0",
    ["0"],
  ],
  [
    "[A] + drop(C, p, center)",
    one,
    (controller) => controller.drop(C, PRIMARY, "center"),
    "C",
    "0",
    ["0"],
  ],
  [
    "[A|B] + drop(A, left, center)",
    two,
    (controller, panes) => controller.drop(A, pane(panes, 0), "center"),
    "right(A,B)",
    "1",
    [],
  ],
  [
    "[A|B] + drop(A, left, right)",
    two,
    (controller, panes) => controller.drop(A, pane(panes, 0), "right"),
    "right(A,B)",
    "1",
    [],
  ],
  [
    "[A] + drop(C, p, right)",
    one,
    (controller) => controller.drop(C, PRIMARY, "right"),
    "right(A,C*)",
    "1",
    ["1"],
  ],
  [
    "[A|B] + drop(A, right, bottom)",
    two,
    (controller, panes) => controller.drop(A, pane(panes, 1), "bottom"),
    "down(B,A)",
    "1",
    ["1"],
  ],
  [
    "6 panes + drop(C, p, right)",
    six,
    (controller) => controller.drop(C, PRIMARY, "right"),
    "right(A,blank,blank,blank,blank,blank)",
    "5",
    [],
  ],
  [
    "[A|B] focus B + hide A",
    two,
    (controller) => {
      controller.removeSessionWithUndo(A);
    },
    "right(blank,B)",
    "1",
    [],
  ],
  [
    "[A|B] focus B + hide A, then unhide",
    two,
    unhide(() => undefined, true),
    "right(A,B)",
    "1",
    ["1"],
  ],
  [
    "unhide after typing in the blank",
    two,
    unhide((controller, panes) => typeInto(controller, pane(panes, 0)), false),
    "right(blank,B)",
    "1",
    [],
  ],
  [
    "unhide after showing C",
    two,
    unhide((controller, panes) => controller.selectSessionInPane(pane(panes, 0), C), false),
    "right(C,B)",
    "0",
    ["0"],
  ],
  ["newChat when already blank", blank, (controller) => controller.newChat(), "blank", "0", ["0"]],
  [
    "selectDraft shown in another pane",
    (controller) => {
      controller.split("right");
      controller.selectSession(B);
    },
    (controller, panes) =>
      controller.selectDraft(controller.viewState.readBlank(pane(panes, 0)).id),
    "right(blank,B)",
    "0",
    ["0"],
  ],
] satisfies readonly (readonly [string, Fixture, Command, string, string, readonly string[]])[])(
  "%s",
  (_name, fixture, command, layout, focused, requested) => {
    const controller = tabPanes();
    fixture(controller);
    const before = controller.getSnapshot();
    const panes = chatPanes(before).map((entry) => entry.pane);
    const requests: PaneId[] = [];
    const stop = controller.store.onFocusRequest((paneId) => requests.push(paneId));
    command(controller, panes);
    stop();
    const after = controller.getSnapshot();

    expect({
      layout: arrangement(after.root, before),
      focused: label(after, after.focus[0]),
      requested: requests.map((paneId) => label(after, paneId)),
    }).toEqual({ layout, focused, requested });
  },
);

function rect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** Lays `fixture` out and gives its panes, in order, the rects present in `rects`. */
function measured(
  fixture: Fixture,
  rects: readonly (ClientRect | undefined)[],
): (controller: PaneController) => ReadonlyMap<PaneId, ClientRect> {
  return (controller) => {
    fixture(controller);

    return new Map(
      chatPanes(controller.getSnapshot()).flatMap((entry, index) => {
        const measure = rects[index];

        return measure === undefined ? [] : [[entry.pane, measure] as const];
      }),
    );
  };
}

const ONE = measured(one, [rect(0, 0, 400, 400)]);

const TWO = measured(two, [rect(0, 0, 400, 400), rect(400, 0, 400, 400)]);

test.each([
  [
    "one pane, its middle: an edge only",
    ONE,
    { x: 200, y: 200 },
    C,
    { pane: 0, placement: "left" },
  ],
  ["one pane, near its right edge", ONE, { x: 390, y: 200 }, C, { pane: 0, placement: "right" }],
  ["one pane, near its bottom edge", ONE, { x: 200, y: 395 }, C, { pane: 0, placement: "bottom" }],
  [
    "two panes, the right one's central quarter",
    TWO,
    { x: 600, y: 200 },
    C,
    { pane: 1, placement: "center" },
  ],
  [
    "two panes, just outside the central quarter",
    TWO,
    { x: 449, y: 200 },
    C,
    { pane: 1, placement: "left" },
  ],
  ["two panes, the left one's top edge", TWO, { x: 200, y: 10 }, C, { pane: 0, placement: "top" }],
  ["over the dragged chat's own pane", TWO, { x: 600, y: 200 }, B, undefined],
  [
    "over another pane than the dragged chat's",
    TWO,
    { x: 200, y: 200 },
    B,
    { pane: 0, placement: "center" },
  ],
  ["a zero-size rect", measured(one, [rect(0, 0, 0, 400)]), { x: 0, y: 200 }, C, undefined],
  [
    "six panes still offer an edge the layout then refuses (D4)",
    measured(
      six,
      Array.from({ length: 6 }, (_, index) => rect(index * 100, 0, 100, 400)),
    ),
    { x: 95, y: 200 },
    C,
    { pane: 0, placement: "right" },
  ],
  ["outside every rect", TWO, { x: 900, y: 200 }, C, undefined],
  [
    "on the shared border, the first pane wins",
    TWO,
    { x: 400, y: 200 },
    C,
    { pane: 0, placement: "right" },
  ],
  [
    "a pane with no rect is skipped",
    measured(two, [undefined, rect(400, 0, 400, 400)]),
    { x: 200, y: 200 },
    C,
    undefined,
  ],
] satisfies readonly (readonly [
  string,
  (controller: PaneController) => ReadonlyMap<PaneId, ClientRect>,
  { readonly x: number; readonly y: number },
  typeof A,
  { readonly pane: number; readonly placement: string } | undefined,
])[])("dropTarget: %s", (_name, build, point, dragged, expected) => {
  const controller = tabPanes();
  const rects = build(controller);
  const layout = controller.getSnapshot();
  const target = dropTarget(layout, rects, point, dragged);

  expect(
    target === undefined
      ? undefined
      : {
          pane: chatPanes(layout).findIndex((entry) => entry.pane === target.paneId),
          placement: target.placement,
        },
  ).toEqual(expected);
});
