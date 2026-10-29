import { expect, test } from "vitest";
import type { Message, SessionView } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { COMPLETED, USAGE, endedTurn, settledTool } from "../../test/view-fixtures.ts";
import { transcriptProjector, transcriptRows } from "./transcript-rows.ts";

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
    seenThrough: null,
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

function work(id: string, at: number, endedAt: number): Message {
  return {
    ...settledTool(id, { kind: "read", path: `/w/${id}.ts` }),
    turn,
    at,
    status: { kind: "settled", commit: asId<"commit">(id), endedAt },
  };
}

function reply(id: string, at: number): Message {
  return { ...answer(id), at };
}

const rowsFor = (turns: Parameters<typeof transcriptRows>[0]["turns"], running = false) =>
  transcriptRows({
    loading: false,
    failed: false,
    turns,
    changes: [],
    prompts: [],
    running,
    held: false,
    retrying: undefined,
  });

test("a finished turn's final reply carries how long the turn worked, from its start to the later of the reply and its last work", () => {
  const earlier = endedTurn([prompt, work("r1", 1_000, 2_000), reply("a1", 3_000)], {
    id: turn,
    startedAt: 500,
  });

  const later = endedTurn([work("r2", 6_000, 9_000), reply("a2", 8_000)], {
    id: asId<"turn">("t2"),
    startedAt: 5_000,
  });

  expect(rowsFor([earlier, later]).filter((row) => row.kind === "response")).toMatchObject([
    { key: "response:a1", ended: true, latest: false, workedMs: 2_500 },
    { key: "response:a2", ended: true, latest: true, workedMs: 4_000 },
  ]);
});

test("a reply with no work before it, or a turn still running, shows no work line", () => {
  const plain = endedTurn([prompt, reply("a1", 3_000)], { id: turn });

  const running = endedTurn([work("r2", 6_000, 9_000), reply("a2", 8_000)], {
    id: asId<"turn">("t2"),
    state: { kind: "working", activity: null },
  });

  expect(rowsFor([plain, running], true).filter((row) => row.kind === "response")).toMatchObject([
    { key: "response:a1", ended: true, workedMs: undefined },
    { key: "response:a2", ended: false },
  ]);
});

test("the live row names the planning status unless the last group names it itself", () => {
  const thinking: Message = {
    id: asId<"message">("th"),
    turn,
    at: 1,
    kind: "part",
    part: asId<"part">("th"),
    partKind: "thinking",
    role: "step",
    state: { markdown: "Weighing it", merged: 1, signature: null },
    version: 1,
    status: { kind: "settled", commit: asId<"commit">("th"), endedAt: 1 },
  };

  const live = (messages: readonly Message[]) =>
    rowsFor(
      [endedTurn(messages, { id: turn, state: { kind: "working", activity: null } })],
      true,
    ).find((row) => row.kind === "live");

  expect(live([thinking])).toMatchObject({ settledWork: true });
  expect(live([thinking, work("r1", 1, 2)])).toMatchObject({ settledWork: false });
});
