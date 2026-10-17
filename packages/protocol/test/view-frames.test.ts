import { asId, asSeq } from "@nyte-ai/schema";
import type { Message, SessionView, ViewFrame } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { applyViewFrame, decodeOutput, encodeOutput, viewFrames } from "../src/index.ts";

const turn = asId<"turn">("t1");

function user(id: string): Message {
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
});
