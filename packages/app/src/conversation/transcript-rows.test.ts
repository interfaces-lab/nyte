import { expect, test } from "vitest";
import type { Message, SessionView } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { COMPLETED, USAGE, endedTurn } from "../../test/view-fixtures.ts";
import { transcriptProjector } from "./transcript-rows.ts";

const turn = asId<"turn">("t");

const prompt = {
  id: asId<"message">("p"),
  turn,
  at: 1,
  kind: "user",
  content: "Fix the build.",
  source: { kind: "user" },
  delivery: "steer",
  status: { kind: "landed", commit: asId<"commit">("p"), run: null, replaced: null },
  siblings: { index: 0, count: 1, ids: [] },
} as const satisfies Message;

function answer(id: string): Message {
  return {
    id: asId<"message">(id),
    turn,
    at: 2,
    kind: "part",
    part: asId<"part">(id),
    partKind: "text",
    role: "answer",
    state: { markdown: id, signature: null },
    version: 1,
    status: { kind: "settled", commit: asId<"commit">(id), endedAt: 2 },
  };
}

const body = [answer("a3"), answer("a4")];

function view(
  messages: readonly Message[],
  leadingPrompt: SessionView["leadingPrompt"],
): SessionView {
  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages,
    queue: [],
    leadingPrompt,
    parts: [],
    turns: [endedTurn([], { id: turn, prompt: prompt.id }).info],
    usage: USAGE,
    execution: COMPLETED,
    reportsHeld: false,
    background: [],
    configuration: { selected: null, effective: null },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

test("a window cut after its turn's prompt leads that turn with the prompt and a gap for its earlier steps, the gap gone and the key kept once paging reaches the prompt", () => {
  const projector = transcriptProjector();

  const keys = (messages: readonly Message[], lead: SessionView["leadingPrompt"]) =>
    projector.rows({ value: view(messages, lead), error: undefined }).map((row) => row.key);

  const cut = { value: view(body, prompt), error: undefined };

  expect(projector.rows(cut).map((row) => row.key)).toEqual([
    "prompt:p",
    "earlier:t",
    "response:a3",
    "row:live",
    "changes:p",
  ]);
  expect(projector.row(cut, "prompt:p")).toMatchObject({
    kind: "part",
    sticky: true,
    message: { content: "Fix the build." },
  });
  expect(projector.row(cut, "earlier:t")).toMatchObject({ kind: "earlier", group: "t" });
  expect(keys([answer("a2"), ...body], prompt)).toEqual([
    "prompt:p",
    "earlier:t",
    "response:a2",
    "row:live",
    "changes:p",
  ]);
  expect(keys([prompt, answer("a1"), answer("a2"), ...body], null)).toEqual([
    "prompt:p",
    "response:a1",
    "row:live",
    "changes:p",
  ]);
});

test("a leading prompt that arrives beside unchanged messages redraws the turn with it", () => {
  const projector = transcriptProjector();
  const bare = { value: view(body, null), error: undefined };
  const led = { value: { ...bare.value, leadingPrompt: prompt }, error: undefined };

  expect(projector.rows(bare).map((row) => row.key)).toEqual([
    "response:a3",
    "row:live",
    "changes:p",
  ]);
  expect(projector.rows(led).map((row) => row.key)).toEqual([
    "prompt:p",
    "earlier:t",
    "response:a3",
    "row:live",
    "changes:p",
  ]);
});
