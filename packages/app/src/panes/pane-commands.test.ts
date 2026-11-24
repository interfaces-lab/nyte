import type { ClientRect } from "@dnd-kit/core";
import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import { paneLayout, PRIMARY, runPane, selectSession, tabPanes } from "../../test/panes.ts";
import { layoutPanes } from "./layout.ts";
import type { Layout, LayoutNode, PaneId } from "./layout.ts";
import { dropTarget } from "./pane-commands.ts";
import type { TabPanes } from "../tabs/window-store.ts";
import type { PaneContent } from "./pane-kinds.ts";
import { chatPanes, paneForSession } from "./pane-layout.ts";

const A = asId<"session">("A");

const B = asId<"session">("B");

const C = asId<"session">("C");

type Fixture = (controller: TabPanes) => void;

type Command = (controller: TabPanes, panes: readonly PaneId[]) => void;

function pane(panes: readonly PaneId[], index: number): PaneId {
  return panes[index] ?? PRIMARY;
}

const blank: Fixture = () => undefined;

const one: Fixture = (controller) => selectSession(controller, A);

const two: Fixture = (controller) => {
  selectSession(controller, A);
  runPane(controller, { kind: "split", direction: "right" });
  selectSession(controller, B);
};

const six: Fixture = (controller) => {
  selectSession(controller, A);

  for (let split = 0; split < 5; split += 1) {
    runPane(controller, { kind: "split", direction: "right" });
  }
};

function unhide(between: Command, accepted: boolean): Command {
  return (controller, panes) => {
    const restore = controller.window.hide(A);
    between(controller, panes);
    restore();
    expect(paneForSession(paneLayout(controller), A) !== undefined).toBe(accepted);
  };
}

function typeInto(controller: TabPanes, paneId: PaneId): void {
  const draft = controller.viewState.readBlank(paneId);
  controller.viewState.writeBlank(paneId, {
    ...draft,
    composer: { ...draft.composer, draft: "Keep", selectionStart: 4, selectionEnd: 4 },
  });
}

function arrangement(node: LayoutNode<PaneContent>, before: Layout<PaneContent>): string {
  if (node.kind === "split") {
    return `${node.direction}(${node.children.map((child) => arrangement(child.node, before)).join(",")})`;
  }
  const tab = node.tab;
  const kept = layoutPanes(before.root).some((entry) => entry.tab.id === tab.id);

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
  ["blank + show A", blank, (controller) => selectSession(controller, A), "A*", "0", ["0"]],
  ["A + show A", one, (controller) => selectSession(controller, A), "A", "0", []],
  [
    "[A|B] focus B + show-in(left, B)",
    two,
    (controller, panes) =>
      runPane(controller, {
        kind: "show-in",
        pane: pane(panes, 0),
        selection: { kind: "session", sessionId: B },
      }),
    "right(A,B)",
    "1",
    [],
  ],
  [
    "[A|B] focus left + show-in(left, C)",
    (controller) => {
      two(controller);
      runPane(controller, {
        kind: "focus",
        pane: pane(
          chatPanes(paneLayout(controller)).map((entry) => entry.pane),
          0,
        ),
      });
    },
    (controller, panes) =>
      runPane(controller, {
        kind: "show-in",
        pane: pane(panes, 0),
        selection: { kind: "session", sessionId: C },
      }),
    "right(C,B)",
    "0",
    ["0"],
  ],
  [
    "[A] + close",
    one,
    (controller) => runPane(controller, { kind: "close", pane: PRIMARY }),
    "blank",
    "0",
    ["0"],
  ],
  [
    "[A|B] + close(left)",
    two,
    (controller, panes) => runPane(controller, { kind: "close", pane: pane(panes, 0) }),
    "B",
    "0",
    ["0"],
  ],
  [
    "[A] + split right",
    one,
    (controller) => runPane(controller, { kind: "split", direction: "right" }),
    "right(A,blank*)",
    "1",
    ["1"],
  ],
  [
    "6 panes + split",
    six,
    (controller) => runPane(controller, { kind: "split", direction: "right" }),
    "right(A,blank,blank,blank,blank,blank)",
    "5",
    [],
  ],
  [
    "[A|B] + drop(B, left, center)",
    two,
    (controller, panes) =>
      runPane(controller, {
        kind: "drop",
        sessionId: B,
        pane: pane(panes, 0),
        placement: "center",
      }),
    "right(B,A)",
    "0",
    ["0"],
  ],
  [
    "[A] + drop(C, p, center)",
    one,
    (controller) =>
      runPane(controller, { kind: "drop", sessionId: C, pane: PRIMARY, placement: "center" }),
    "C",
    "0",
    ["0"],
  ],
  [
    "[A|B] + drop(A, left, center)",
    two,
    (controller, panes) =>
      runPane(controller, {
        kind: "drop",
        sessionId: A,
        pane: pane(panes, 0),
        placement: "center",
      }),
    "right(A,B)",
    "1",
    [],
  ],
  [
    "[A|B] + drop(A, left, right)",
    two,
    (controller, panes) =>
      runPane(controller, { kind: "drop", sessionId: A, pane: pane(panes, 0), placement: "right" }),
    "right(A,B)",
    "1",
    [],
  ],
  [
    "[A] + drop(C, p, right)",
    one,
    (controller) =>
      runPane(controller, { kind: "drop", sessionId: C, pane: PRIMARY, placement: "right" }),
    "right(A,C*)",
    "1",
    ["1"],
  ],
  [
    "[A|B] + drop(A, right, bottom)",
    two,
    (controller, panes) =>
      runPane(controller, {
        kind: "drop",
        sessionId: A,
        pane: pane(panes, 1),
        placement: "bottom",
      }),
    "down(B,A)",
    "1",
    ["1"],
  ],
  [
    "6 panes + drop(C, p, right)",
    six,
    (controller) =>
      runPane(controller, { kind: "drop", sessionId: C, pane: PRIMARY, placement: "right" }),
    "right(A,blank,blank,blank,blank,blank)",
    "5",
    [],
  ],
  [
    "[A|B] focus B + hide A",
    two,
    (controller) => {
      controller.window.hide(A);
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
    unhide(
      (controller, panes) =>
        runPane(controller, {
          kind: "show-in",
          pane: pane(panes, 0),
          selection: { kind: "session", sessionId: C },
        }),
      false,
    ),
    "right(C,B)",
    "0",
    ["0"],
  ],
  [
    "newChat when already blank",
    blank,
    (controller) => controller.window.newChat(controller.tabId),
    "blank",
    "0",
    ["0"],
  ],
  [
    "selectDraft shown in another pane",
    (controller) => {
      runPane(controller, { kind: "split", direction: "right" });
      selectSession(controller, B);
    },
    (controller, panes) =>
      controller.window.selectDraft(
        controller.tabId,
        controller.viewState.readBlank(pane(panes, 0)).id,
      ),
    "right(blank,B)",
    "0",
    ["0"],
  ],
] satisfies readonly (readonly [string, Fixture, Command, string, string, readonly string[]])[])(
  "%s",
  (_name, fixture, command, layout, focused, requested) => {
    const controller = tabPanes();
    fixture(controller);
    const before = paneLayout(controller);
    const panes = chatPanes(before).map((entry) => entry.pane);
    const requests: PaneId[] = [];
    const stop = controller.layout.onFocusRequest((paneId) => requests.push(paneId));
    command(controller, panes);
    stop();
    const after = paneLayout(controller);

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

function measured(
  fixture: Fixture,
  rects: readonly (ClientRect | undefined)[],
): (controller: TabPanes) => ReadonlyMap<PaneId, ClientRect> {
  return (controller) => {
    fixture(controller);

    return new Map(
      chatPanes(paneLayout(controller)).flatMap((entry, index) => {
        const measure = rects[index];

        return measure === undefined ? [] : [[entry.pane, measure] as const];
      }),
    );
  };
}

const ONE = measured(one, [rect(0, 0, 400, 400)]);

const TWO = measured(two, [rect(0, 0, 400, 400), rect(400, 0, 400, 400)]);

const WIDE = 1920;

const SIX = measured(
  six,
  Array.from({ length: 6 }, (_, index) => rect(index * 100, 0, 100, 400)),
);

test.each([
  [
    "one pane, its middle: an edge only",
    ONE,
    { x: 200, y: 200 },
    C,
    WIDE,
    { pane: 0, placement: "left" },
  ],
  [
    "one pane, near its right edge",
    ONE,
    { x: 390, y: 200 },
    C,
    WIDE,
    { pane: 0, placement: "right" },
  ],
  [
    "one pane, near its bottom edge",
    ONE,
    { x: 200, y: 395 },
    C,
    WIDE,
    { pane: 0, placement: "bottom" },
  ],
  [
    "two panes, the right one's central quarter",
    TWO,
    { x: 600, y: 200 },
    C,
    WIDE,
    { pane: 1, placement: "center" },
  ],
  [
    "two panes, just outside the central quarter",
    TWO,
    { x: 449, y: 200 },
    C,
    WIDE,
    { pane: 1, placement: "left" },
  ],
  [
    "two panes, the left one's top edge",
    TWO,
    { x: 200, y: 10 },
    C,
    WIDE,
    { pane: 0, placement: "top" },
  ],
  ["over the dragged chat's own pane", TWO, { x: 600, y: 200 }, B, WIDE, undefined],
  [
    "over another pane than the dragged chat's",
    TWO,
    { x: 200, y: 200 },
    B,
    WIDE,
    { pane: 0, placement: "center" },
  ],
  ["a zero-size rect", measured(one, [rect(0, 0, 0, 400)]), { x: 0, y: 200 }, C, WIDE, undefined],
  [
    "six panes offer a new chat only the centre (D4)",
    SIX,
    { x: 95, y: 200 },
    C,
    WIDE,
    { pane: 0, placement: "center" },
  ],
  [
    "six panes still move a chat they show to an edge",
    SIX,
    { x: 195, y: 200 },
    A,
    WIDE,
    { pane: 1, placement: "right" },
  ],
  [
    "a window too narrow for Split offers a new chat only the centre (D4)",
    TWO,
    { x: 449, y: 200 },
    C,
    959,
    { pane: 1, placement: "center" },
  ],
  [
    "one pane in a window too narrow for Split: the centre",
    ONE,
    { x: 390, y: 200 },
    C,
    639,
    { pane: 0, placement: "center" },
  ],
  [
    "a window just wide enough for Split keeps the edge",
    TWO,
    { x: 449, y: 200 },
    C,
    960,
    { pane: 1, placement: "left" },
  ],
  [
    "a narrow window still moves a chat the panes show",
    TWO,
    { x: 449, y: 200 },
    A,
    640,
    { pane: 1, placement: "left" },
  ],
  ["outside every rect", TWO, { x: 900, y: 200 }, C, WIDE, undefined],
  [
    "on the shared border, the first pane wins",
    TWO,
    { x: 400, y: 200 },
    C,
    WIDE,
    { pane: 0, placement: "right" },
  ],
  [
    "a pane with no rect is skipped",
    measured(two, [undefined, rect(400, 0, 400, 400)]),
    { x: 200, y: 200 },
    C,
    WIDE,
    undefined,
  ],
] satisfies readonly (readonly [
  string,
  (controller: TabPanes) => ReadonlyMap<PaneId, ClientRect>,
  { readonly x: number; readonly y: number },
  typeof A,
  number,
  { readonly pane: number; readonly placement: string } | undefined,
])[])("dropTarget: %s", (_name, build, point, dragged, width, expected) => {
  const controller = tabPanes();
  const rects = build(controller);
  const layout = paneLayout(controller);
  const target = dropTarget(layout, rects, point, dragged, width);

  expect(
    target === undefined
      ? undefined
      : {
          pane: chatPanes(layout).findIndex((entry) => entry.pane === target.paneId),
          placement: target.placement,
        },
  ).toEqual(expected);
});
