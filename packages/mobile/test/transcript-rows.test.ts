import { asId, asSeq } from "@nyte-ai/schema";
import type { Message, SessionView } from "@nyte-ai/sdk";
import { describe, expect, it } from "vitest";
import { conversationRows } from "../src/chat/transcript-rows.ts";

const turn = asId<"turn">("turn-1");

function part(id: string, partKind: string, state: unknown): Message {
  return {
    id: asId<"message">(id),
    turn,
    at: 1,
    kind: "part",
    part: asId<"part">(id),
    partKind,
    role: "answer",
    state,
    version: 1,
    status: { kind: "settled", commit: asId<"commit">(`${id}-commit`), endedAt: 1 },
  };
}

function view(messages: readonly Message[]): SessionView {
  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(0),
    activation: { kind: "active" },
    messages,
    parts: [],
    turns: [
      {
        id: turn,
        run: null,
        prompt: null,
        state: {
          kind: "ended",
          end: {
            kind: "completed",
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              reasoning: null,
              total: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
          },
        },
        startedAt: 0,
        endedAt: 1,
        steps: 0,
        thinkingOnly: false,
        summary: { byClass: {}, failed: 0, stopped: 0, added: 0, removed: 0 },
      },
    ],
    execution: { kind: "idle", lastRun: null },
    background: [],
    configuration: { selected: null, effective: null },
    context: { tokens: 0, window: 1, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

const canvas = {
  runtime: 1,
  title: "Usage",
  code: "export default () => null",
  height: 240,
  error: null,
};

describe("conversationRows", () => {
  it("draws a canvas part as a canvas row carrying its part id and state", () => {
    const rows = conversationRows(
      view([
        part("text-1", "text", { markdown: "Here it is" }),
        part("canvas-1", "canvas", canvas),
      ]),
    );

    expect(rows.slice(0, 2)).toEqual([
      { kind: "assistant", id: "text-1", text: "Here it is", streaming: false },
      { kind: "canvas", id: "canvas-1", part: "canvas-1", ...canvas },
    ]);
  });

  it("keeps a canvas row's identity while its message is unchanged, and makes a new one when it is replaced", () => {
    const message = part("canvas-1", "canvas", canvas);
    const first = conversationRows(view([message]))[0];
    const again = conversationRows(view([message]))[0];

    const replaced = conversationRows(
      view([part("canvas-1", "canvas", { ...canvas, code: "export default () => 1" })]),
    )[0];

    expect(again).toBe(first);
    expect(replaced).not.toBe(first);
    expect(replaced).toMatchObject({
      kind: "canvas",
      id: "canvas-1",
      code: "export default () => 1",
    });
  });

  it("still skips part kinds this app has no row for", () => {
    expect(conversationRows(view([part("other-1", "maps/places", {})]))).toEqual([]);
  });
});
