import { asId } from "@nyte-ai/schema";
import type { HeadRow, Message, TurnInfo } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { headView } from "../src/head-view.ts";
import type { HeadRows, HeadSnapshot } from "../src/live-head.ts";

const MAIN = asId<"head">("main");

const UNTOUCHED = { count: 0, paths: [] };

function turn(id: string): TurnInfo {
  return {
    id: asId(id),
    run: null,
    prompt: null,
    state: { kind: "working", activity: null },
    startedAt: 1,
    endedAt: null,
    steps: 0,
    thinkingOnly: false,
    summary: {
      byClass: {
        read: UNTOUCHED,
        list: UNTOUCHED,
        edit: UNTOUCHED,
        shell: UNTOUCHED,
        delegate: UNTOUCHED,
        custom: UNTOUCHED,
      },
      failed: 0,
      stopped: 0,
      added: 0,
      removed: 0,
    },
  };
}

function answer(id: string, turnId: string, markdown: string): Message {
  return {
    id: asId(id),
    turn: asId(turnId),
    at: 1,
    kind: "part",
    part: asId(`part-${id}`),
    partKind: "text",
    role: "answer",
    state: { markdown },
    version: 1,
    status: { kind: "live", run: null },
  };
}

function queued(id: string): Message {
  return {
    id: asId(id),
    turn: asId("t-queued"),
    at: 2,
    kind: "user",
    content: "later",
    source: { kind: "user" },
    delivery: "queue",
    status: {
      kind: "pending",
      schedule: { kind: "next-turn", reason: "requested" },
      covered: false,
    },
    siblings: { index: 0, count: 1, ids: [] },
  };
}

function snapshot(): HeadSnapshot {
  const head: HeadRow = {
    name: MAIN,
    revision: null,
    execution: { kind: "idle", lastRun: null },
    reportsHeld: false,
    seenThrough: null,
    queue: [asId("q")],
  };

  const messages = [answer("a", "t1", "One."), answer("b", "t2", "Two."), queued("q")];

  const rows: HeadRows = {
    messages: new Map(messages.map((message) => [message.id, message])),
    turns: new Map([turn("t1"), turn("t2")].map((info) => [info.id, info])),
    parts: new Map(),
    changes: new Map(),
    catalog: new Map(),
    heads: new Map([[MAIN, head]]),
    settings: new Map(),
    usage: new Map(),
    background: new Map(),
  };

  return {
    head: MAIN,
    order: [asId("a"), asId("b")],
    leadingPrompt: null,
    activation: { kind: "active" },
    rows,
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

it("rebuilds only the changed message and the list holding it, keeping every other row and list", () => {
  const first = snapshot();
  const changed = answer("b", "t2", "Two, longer.");

  const second: HeadSnapshot = {
    ...first,
    rows: { ...first.rows, messages: new Map(first.rows.messages).set(changed.id, changed) },
  };

  const before = headView(first);
  const after = headView(second);

  expect(before.messages.map((message) => message.id)).toEqual(["a", "b"]);
  expect(before.turns.map((info) => info.id)).toEqual(["t1", "t2"]);
  expect(before.queue.map((message) => message.id)).toEqual(["q"]);
  expect(after).not.toBe(before);
  expect(after.messages).not.toBe(before.messages);
  expect(after.messages[1]).toBe(changed);
  expect(after.messages[0]).toBe(before.messages[0]);
  expect(after.turns).toBe(before.turns);
  expect(after.queue).toBe(before.queue);
  expect(after.parts).toBe(before.parts);
  expect(after.catalog).toBe(before.catalog);
  expect(after.background).toBe(before.background);
  expect(headView(second)).toBe(after);
  expect(headView({ ...second })).toBe(after);
});
