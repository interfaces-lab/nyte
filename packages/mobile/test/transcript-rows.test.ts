import { canvas } from "@nyte-ai/plugin/canvas/schema";
import type { CanvasState } from "@nyte-ai/plugin/canvas/schema";
import { text } from "@nyte-ai/plugin/client";
import type { PartDefinition, PartState } from "@nyte-ai/plugin/client";
import { asId, asSeq } from "@nyte-ai/schema";
import type { Message, SessionView } from "@nyte-ai/sdk";
import { describe, expect, it } from "vitest";
import { conversationRows } from "../src/chat/transcript-rows.ts";

type PartMessage = Extract<Message, { readonly kind: "part" }>;

const turn = asId<"turn">("turn-1");

function part<K extends PartDefinition>(
  id: string,
  definition: K,
  state: PartState<K>,
): PartMessage {
  return {
    id: asId<"message">(id),
    turn,
    at: 1,
    kind: "part",
    part: asId<"part">(id),
    partKind: definition.kind,
    role: "answer",
    state,
    version: 1,
    status: { kind: "settled", commit: asId<"commit">(`${id}-commit`), endedAt: 1 },
  };
}

const untouched = { count: 0, paths: [] };

function view(
  messages: readonly Message[],
  leadingPrompt: SessionView["leadingPrompt"] = null,
): SessionView {
  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(0),
    activation: { kind: "active" },
    messages,
    leadingPrompt,
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
        summary: {
          byClass: {
            read: untouched,
            list: untouched,
            edit: untouched,
            shell: untouched,
            delegate: untouched,
            custom: untouched,
          },
          failed: 0,
          stopped: 0,
          added: 0,
          removed: 0,
        },
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

const usage: CanvasState = {
  runtime: 1,
  title: "Usage",
  code: "export default () => null",
  height: 240,
  error: null,
};

describe("conversationRows", () => {
  it("leads a turn its window cut with the prompt the view carries beside it and marks its earlier steps as not shown", () => {
    const rows = conversationRows(
      view([part("text-1", text, { markdown: "Done.", signature: null })], {
        id: asId<"message">("prompt-1"),
        turn,
        at: 0,
        kind: "user",
        content: "Fix it.",
        source: { kind: "user" },
        delivery: "steer",
        status: { kind: "landed", commit: asId<"commit">("prompt-1"), run: null, replaced: null },
        siblings: { index: 0, count: 1, ids: [] },
      }),
    );

    expect(rows.slice(0, 3)).toEqual([
      { kind: "user", id: "submission:prompt-1", content: "Fix it.", delivery: "sent" },
      { kind: "marker", id: "earlier:turn-1", text: "Earlier steps not shown" },
      { kind: "assistant", id: "text-1", text: "Done.", streaming: false },
    ]);
  });

  it("draws a canvas part as a canvas row carrying its part id and state", () => {
    const rows = conversationRows(
      view([
        part("text-1", text, { markdown: "Here it is", signature: null }),
        part("canvas-1", canvas, usage),
      ]),
    );

    expect(rows.slice(0, 2)).toEqual([
      { kind: "assistant", id: "text-1", text: "Here it is", streaming: false },
      { kind: "canvas", id: "canvas-1", part: "canvas-1", ...usage },
    ]);
  });

  it("keeps a canvas row's identity while its message is unchanged, and makes a new one when it is replaced", () => {
    const drawn = part("canvas-1", canvas, usage);
    const first = conversationRows(view([drawn]))[0];
    const again = conversationRows(view([drawn]))[0];

    const replaced = conversationRows(
      view([part("canvas-1", canvas, { ...usage, code: "export default () => 1" })]),
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
    expect(
      conversationRows(view([{ ...part("other-1", canvas, usage), partKind: "maps/places" }])),
    ).toEqual([]);
  });
});
