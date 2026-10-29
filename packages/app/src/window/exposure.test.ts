import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { reducePaneLayout } from "../layout/pane-layout.ts";
import type { PaneLayoutAction } from "../layout/pane-layout.ts";
import { activeTab, initialWindow, reduce, tabLayout } from "../tabs/model.ts";
import type { WindowAction, WindowState } from "../tabs/model.ts";
import { chatsFor, COMPLETED, sessionRow } from "../../test/view-fixtures.ts";
import { expose, shownChats } from "./exposure.ts";
import type { WindowView } from "./exposure.ts";
import { reduceTrays } from "./tray.ts";
import type { TrayView } from "./tray.ts";

const left = asId<"session">("left");

const right = asId<"session">("right");

const agent = asId<"session">("agent");

const behind = asId<"session">("behind");

const showsAgent: TrayView = { kind: "detail", sessionId: agent };

const unreadHeads = [
  {
    name: asId<"head">("main"),
    tip: { kind: "start" },
    stack: null,
    execution: COMPLETED,
    unread: true,
  },
] as const;

let lastId = 1;

function nextId(): string {
  lastId += 1;

  return `t${String(lastId)}`;
}

function run(actions: readonly WindowAction[], state = initialWindow("t1")): WindowState {
  return actions.reduce((current, action) => reduce(current, action, nextId), state);
}

function open(sessionId: SessionId): WindowAction {
  return { kind: "open", place: { kind: "session", sessionId }, target: "permanent" };
}

function pane(state: WindowState, action: PaneLayoutAction): WindowState {
  const tab = activeTab(state);

  return run(
    [{ kind: "layout", tabId: tab.id, layout: reducePaneLayout(tabLayout(tab), action) }],
    state,
  );
}

function view(tabs: WindowState, change: Partial<WindowView> = {}): WindowView {
  return {
    tabs,
    trays: new Map(),
    settings: false,
    covered: false,
    focused: true,
    chats: new Map(),
    ...change,
  };
}

function sorted(chats: ReadonlySet<SessionId>): readonly SessionId[] {
  return [...chats].toSorted();
}

const single = run([open(behind), open(left)]);

const split = pane(pane(single, { kind: "split", direction: "right" }), {
  kind: "select",
  selection: { kind: "session", sessionId: right },
});

test("a single pane shows its chat and nothing in another tab", () => {
  expect(expose(view(single))).toMatchObject({ shown: new Set([left]), looking: new Set([left]) });
});

test("an unread chat stays unread everywhere except while someone is looking at it", () => {
  const chats = chatsFor([
    sessionRow("left", { heads: unreadHeads }),
    sessionRow("behind", { heads: unreadHeads }),
  ]);

  expect(sorted(expose(view(single, { chats })).unread)).toEqual([behind]);
  expect(sorted(expose(view(single, { chats, focused: false })).unread)).toEqual([behind, left]);
});

test("every surface reads the same unread answer as the dot", () => {
  const chats = chatsFor([
    sessionRow("left", { heads: unreadHeads }),
    sessionRow("behind", { heads: unreadHeads }),
  ]);

  const unread = expose(view(single, { chats })).unread;
  const shown = shownChats(chats, unread);

  expect(shown.get(left)?.unread).toBe(false);
  expect(shown.get(behind)?.unread).toBe(true);
  expect(shown.get(behind)).toBe(chats.get(behind));
  expect(shownChats(chats, unread)).toBe(shown);
});

test("both panes of a split are looked at, whichever has focus", () => {
  const exposure = expose(view(pane(split, { kind: "focus", paneId: "primary" })));

  expect(sorted(exposure.shown)).toEqual([left, right]);
  expect(sorted(exposure.looking)).toEqual([left, right]);
});

test("a tray's agent is looked at instead of the chat it covers", () => {
  const exposure = expose(view(split, { trays: new Map([[left, showsAgent]]) }));

  expect(sorted(exposure.shown)).toEqual([agent, left, right]);
  expect(sorted(exposure.looking)).toEqual([agent, right]);

  const hidden = expose(view(split, { trays: new Map([[behind, showsAgent]]) }));

  expect(hidden.shown.has(agent), "a tray in a tab not on screen shows nothing").toBe(false);
});

test("each chat has one tray view, and only an open agent covers the chat under it", () => {
  const listed = reduceTrays(new Map(), {
    kind: "tray",
    parent: left,
    view: { kind: "list", retainedSessionId: undefined },
  });

  const detail = reduceTrays(listed, { kind: "tray", parent: left, view: showsAgent });

  const terminals = reduceTrays(detail, {
    kind: "tray",
    parent: left,
    view: { kind: "terminals" },
  });

  expect(sorted(expose(view(split, { trays: listed })).looking)).toEqual([left, right]);
  expect(sorted(expose(view(split, { trays: detail })).looking)).toEqual([agent, right]);
  expect(detail.get(left), "an agent replaces the list it was opened from").toBe(showsAgent);
  expect(sorted(expose(view(split, { trays: terminals })).shown)).toEqual([left, right]);
  expect(
    reduceTrays(terminals, { kind: "tray", parent: left, view: { kind: "closed" } }).size,
  ).toBe(0);
});

test("a maximized workbench or an unfocused window keeps chats shown but not looked at", () => {
  for (const change of [{ covered: true }, { focused: false }]) {
    const exposure = expose(view(split, { ...change, trays: new Map([[left, showsAgent]]) }));

    expect(sorted(exposure.shown)).toEqual([agent, left, right]);
    expect(exposure.looking.size).toBe(0);
  }
});

test("a page or settings leaves no chat on screen, even with the chat tab kept underneath", () => {
  const page = run(
    [
      {
        kind: "open",
        place: { kind: "customize", section: undefined, sessionId: undefined },
        target: "permanent",
      },
    ],
    single,
  );

  for (const exposure of [expose(view(page)), expose(view(single, { settings: true }))]) {
    expect(exposure.shown.size).toBe(0);
    expect(exposure.looking.size).toBe(0);
  }
});
