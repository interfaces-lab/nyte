import { asId, asSeq, SdkError } from "@nyte-ai/schema";
import type { Message, SessionInfo, SessionView, ViewFrame } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import {
  applyViewFrame,
  decodeOutput,
  encodeOutput,
  sessionLists,
  sessionsFrames,
  viewFrames,
} from "../src/index.ts";

const turn = asId<"turn">("t1");

function user(id: string): Extract<Message, { readonly kind: "user" }> {
  return {
    id: asId(id),
    turn,
    at: 1,
    kind: "user",
    content: id,
    source: { kind: "user" },
    delivery: "steer",
    status: { kind: "pending", schedule: { kind: "next-turn", reason: "idle" }, covered: true },
    siblings: { index: 0, count: 1, ids: [] },
  };
}

const status = { kind: "live", run: asId<"run">("r1") } as const;

function answer(markdown: string, version: number): Message {
  return {
    id: asId("answer"),
    turn,
    at: 2,
    kind: "part",
    part: asId("answer"),
    partKind: "text",
    role: "answer",
    state: { markdown, signature: null },
    version,
    status,
  };
}

const base: SessionView = {
  revision: null,
  seq: asSeq(1),
  activation: { kind: "active" },
  messages: [user("m1"), user("m2")],
  leadingPrompt: null,
  parts: [],
  turns: [],
  usage: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: null,
    total: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  execution: { kind: "idle", lastRun: null },
  background: [],
  configuration: { selected: null, effective: null },
  context: { tokens: 0, window: 0, lastRequest: null },
  heads: [],
  changes: [],
  catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
};

async function sent(views: readonly SessionView[]): Promise<readonly ViewFrame[]> {
  const frames: ViewFrame[] = [];

  for await (const frame of viewFrames(
    (async function* () {
      yield* views;
    })(),
  ))
    frames.push(
      decodeOutput("head.watch", JSON.parse(JSON.stringify(encodeOutput("head.watch", frame)))),
    );

  return frames;
}

describe("view frames", () => {
  it("sends the first view whole and each later one as the changes a client applies back to it", async () => {
    const [m1, m2] = base.messages;
    assert(m1 !== undefined && m2 !== undefined);
    const streaming = answer("Hel", 1);
    const appended = { ...base, seq: asSeq(2), messages: [m1, m2, streaming] };
    const grown = { ...appended, seq: asSeq(3), messages: [m1, m2, answer("Hello.", 3)] };
    const slid = { ...grown, seq: asSeq(4), messages: [m2, answer("Hello.", 3), user("m3")] };
    const moved = { ...slid, seq: asSeq(5), revision: asId<"revision">("r2"), messages: [] };
    const views = [base, appended, grown, slid, moved];
    const frames = await sent(views);
    let shown: SessionView | null = null;

    for (const [index, frame] of frames.entries()) {
      const previous = shown;
      shown = applyViewFrame(previous, frame);

      expect(shown).toEqual(views[index]);
      expect(shown.parts).toBe(previous?.parts ?? shown.parts);
    }

    expect(frames.map((frame) => frame.kind)).toEqual(["view", "delta", "delta", "delta", "delta"]);
    expect(frames[1]).toMatchObject({ messages: { runs: [0, 2, -1, 1] } });
    expect(frames[2]).toEqual({
      kind: "delta",
      seq: 3,
      appends: [{ at: 2, append: "lo.", version: 3 }],
    });
    expect(frames[4]).toEqual({
      kind: "delta",
      seq: 5,
      revision: "r2",
      messages: { runs: [], items: [] },
    });
  });

  it("sends the leading prompt once when it changes, leaves it out while it holds, and clears it with null", async () => {
    const [m1, m2] = base.messages;
    assert(m1 !== undefined && m2 !== undefined);
    const led = { ...base, seq: asSeq(2), leadingPrompt: user("m0") };
    const streaming = { ...led, seq: asSeq(3), messages: [m1, m2, answer("Hel", 1)] };
    const grown = { ...streaming, seq: asSeq(4), messages: [m1, m2, answer("Hello.", 2)] };
    const cleared = { ...grown, seq: asSeq(5), leadingPrompt: null };
    const views = [base, led, streaming, grown, cleared];
    const frames = await sent(views);
    const shown: SessionView[] = [];

    for (const frame of frames) shown.push(applyViewFrame(shown.at(-1) ?? null, frame));

    expect(shown).toEqual(views);
    expect(frames[1]).toEqual({ kind: "delta", seq: 2, leadingPrompt: user("m0") });
    expect(frames[3]).toEqual({
      kind: "delta",
      seq: 4,
      appends: [{ at: 2, append: "lo.", version: 2 }],
    });
    expect(frames[4]).toEqual({ kind: "delta", seq: 5, leadingPrompt: null });
    expect(shown[3]?.leadingPrompt).toBe(shown[1]?.leadingPrompt);
    expect(shown[4]?.leadingPrompt).toBeNull();
  });

  it("keeps the client's own items for every item a delta copies", async () => {
    const frames = await sent([
      base,
      { ...base, seq: asSeq(2), messages: [...base.messages, user("m3")] },
    ]);

    const [first, second] = frames;
    assert(first !== undefined && second !== undefined);

    const shown = applyViewFrame(null, first);
    const next = applyViewFrame(shown, second);

    expect(next.messages[0]).toBe(shown.messages[0]);
    expect(next.messages[1]).toBe(shown.messages[1]);
    expect(() => applyViewFrame(null, second)).toThrow("A view delta arrived before its view.");
    expect(() => applyViewFrame({ ...shown, messages: [] }, second)).toThrow(
      "A view delta does not fit the view before it.",
    );
  });

  it("reads a newer host's frames item by item", () => {
    const future = { id: "m9", turn, at: 3, kind: "system", text: "Rebased." };
    const paused = { ...answer("Hi", 1), status: { kind: "paused", until: 9 }, extra: true };
    const view = { ...base, messages: [...base.messages, future, paused], newer: { field: 1 } };

    const shown = applyViewFrame(null, decodeOutput("head.watch", { kind: "view", view }));

    const delta = decodeOutput("head.watch", {
      kind: "delta",
      seq: 2,
      messages: { runs: [0, 4, -1, 1], items: [{ ...future, id: "m10" }] },
    });

    expect(shown.messages.slice(0, 2)).toEqual(base.messages);
    expect(shown.messages[2]).toEqual({
      id: "m9",
      turn,
      at: 3,
      kind: "part",
      part: "m9",
      partKind: "system",
      role: "note",
      state: future,
      version: 0,
      status: { kind: "settled", commit: "", endedAt: 3 },
    });
    expect(shown.messages[3]).toMatchObject({
      partKind: "text",
      role: "answer",
      state: { markdown: "Hi", signature: null },
      status: { kind: "settled" },
    });
    expect(applyViewFrame(shown, delta).messages.map((message) => message.id)).toEqual([
      "m1",
      "m2",
      "m9",
      "answer",
      "m10",
    ]);
    expect(() => decodeOutput("head.watch", { kind: "rebased", seq: 2 })).toThrow(SdkError);
  });

  it("keeps the fields a newer host adds to a part it can read", () => {
    const part = {
      ...answer("Hi", 1),
      shimmer: 1,
      state: { markdown: "Hi", signature: null, lang: "en" },
    };

    const view = decodeOutput("head.view", { ...base, messages: [part] });

    expect(view.messages).toEqual([part]);
  });
});

function info(id: string, name: string, lastActivityAt = 1): SessionInfo {
  return {
    id: asId(id),
    name,
    parent: null,
    call: null,
    workspace: asId("w1"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [],
    createdAt: 1,
    lastActivityAt,
  };
}

async function listed(
  lists: readonly (readonly SessionInfo[])[],
): Promise<{ readonly frames: readonly unknown[]; readonly shown: readonly SessionInfo[][] }> {
  const frames: unknown[] = [];

  for await (const frame of sessionsFrames(
    (async function* () {
      yield* lists;
    })(),
  ))
    frames.push(JSON.parse(JSON.stringify(encodeOutput("sessions.watch", frame))));

  return { frames, shown: await rebuilt(frames) };
}

async function rebuilt(frames: readonly unknown[]): Promise<SessionInfo[][]> {
  const shown: SessionInfo[][] = [];

  for await (const list of sessionLists(
    (async function* () {
      for (const frame of frames) yield decodeOutput("sessions.watch", frame);
    })(),
  ))
    shown.push([...list]);

  return shown;
}

describe("sessions frames", () => {
  it("sends the first list whole and each later one as its order and changed rows, which a client rebuilds through updates, moves, additions and removals", async () => {
    const a = info("a", "Alpha");
    const b = info("b", "Beta");
    const c = info("c", "Gamma");
    const renamed = info("b", "Beta two", 2);
    const d = info("d", "Delta", 3);
    const lists = [
      [a, b, c],
      [a, renamed, c],
      [c, a, renamed],
      [d, c, a, renamed],
      [d, a, renamed],
    ];

    const { frames, shown } = await listed(lists);

    expect(shown.map((list) => list.map((row) => `${row.id}:${row.name}`))).toEqual([
      ["a:Alpha", "b:Beta", "c:Gamma"],
      ["a:Alpha", "b:Beta two", "c:Gamma"],
      ["c:Gamma", "a:Alpha", "b:Beta two"],
      ["d:Delta", "c:Gamma", "a:Alpha", "b:Beta two"],
      ["d:Delta", "a:Alpha", "b:Beta two"],
    ]);
    expect(shown).toEqual(lists);
    expect(frames).toEqual([
      { kind: "list", order: { runs: [-1, 3], items: ["a", "b", "c"] }, items: [a, b, c] },
      { kind: "delta", order: { runs: [0, 1, -1, 1, 2, 1], items: ["b"] }, items: [renamed] },
      { kind: "delta", order: { runs: [2, 1, 0, 2], items: [] }, items: [] },
      { kind: "delta", order: { runs: [-1, 1, 0, 3], items: ["d"] }, items: [d] },
      { kind: "delta", order: { runs: [0, 1, 2, 2], items: [] }, items: [] },
    ]);
  });

  it("starts over at a list frame, as a reopened watch sends after a reconnect", async () => {
    const a = info("a", "Alpha");
    const before = await listed([[a], [a, info("b", "Beta")]]);
    const after = await listed([[info("c", "Gamma"), a]]);

    const shown = await rebuilt([...before.frames, ...after.frames]);

    expect(shown.map((list) => list.map((row) => row.id))).toEqual([["a"], ["a", "b"], ["c", "a"]]);
  });

  it("leaves out a row it cannot read and keeps every later frame's positions", async () => {
    const session = info("s1", "Readable");
    const newer = { ...info("s2", "Newer"), activation: { kind: "hibernating" } };

    const shown = await rebuilt([
      { kind: "list", order: { runs: [-1, 2], items: ["s2", "s1"] }, items: [newer, session] },
      {
        kind: "delta",
        order: { runs: [-1, 1, 0, 2], items: ["s3"] },
        items: [info("s3", "Third")],
      },
      {
        kind: "delta",
        order: { runs: [0, 1, -1, 1, 2, 1], items: ["s2"] },
        items: [info("s2", "Readable again")],
      },
    ]);

    expect(shown.map((list) => list.map((row) => `${row.id}:${row.name}`))).toEqual([
      ["s1:Readable"],
      ["s3:Third", "s1:Readable"],
      ["s3:Third", "s2:Readable again", "s1:Readable"],
    ]);
  });

  it("refuses a delta before any list and one that does not fit the list before it", async () => {
    const delta = { kind: "delta", order: { runs: [0, 2], items: [] }, items: [] };

    await expect(rebuilt([delta])).rejects.toThrow("A sessions delta arrived before its list.");
    await expect(
      rebuilt([{ kind: "list", order: { runs: [-1, 1], items: ["a"] }, items: [] }, delta]),
    ).rejects.toThrow("A view delta does not fit the view before it.");
  });
});

describe("positional arrays", () => {
  it("keeps an item of an unknown kind in a view's own arrays, so the frame fails instead of shifting later deltas", () => {
    const view = { ...base, background: [{ kind: "future", id: "b1" }] };

    expect(() => decodeOutput("head.watch", { kind: "view", view })).toThrow(SdkError);
    expect(() =>
      decodeOutput("head.watch", {
        kind: "delta",
        seq: 2,
        changes: { runs: [-1, 1], items: [{ kind: "future", path: "a.ts" }] },
      }),
    ).toThrow(SdkError);
  });

  it("still drops an unreadable item from an array a delta replaces whole, as in other rows", () => {
    const catalog = { ...base.catalog, skills: [{ kind: "future" }] };

    const decoded = decodeOutput("head.watch", { kind: "view", view: { ...base, catalog } });

    if (decoded.kind !== "view") throw new Error("expected a view");
    expect(decoded.view.catalog).toEqual(base.catalog);
    expect(() =>
      decodeOutput("head.watch", { kind: "delta", seq: 2, appends: [{ kind: "future" }] }),
    ).toThrow(SdkError);
  });
});
