import { expect, test } from "vitest";
import type { Message, SessionView } from "@nyte-ai/sdk";
import type { SessionActivity } from "../../data/session-activity.ts";
import { asId, asSeq } from "@nyte-ai/schema";
import { COMPLETED, USAGE, endedTurn, settledTool } from "../../../test/view-fixtures.ts";
import {
  stickySpans,
  stuckPrompt,
  transcriptProjector,
  transcriptRows,
} from "./transcript-rows.ts";
import type { RowLayout, StickyPrompt } from "./transcript-rows.ts";

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
): SessionView & { readonly activity: SessionActivity } {
  return {
    activity: { kind: "idle" },
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
    context: { tokens: 0, window: 1000, lastRequest: null },
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

test("a window cut after its turn's prompt leads that turn with the prompt and a gap for its earlier steps, the gap gone and the key kept once paging reaches the prompt", () => {
  const projector = transcriptProjector({ thinking: true });

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
  const projector = transcriptProjector({ thinking: true });
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
    live: { planning: false, newest: undefined, thought: undefined, awaiting: undefined },
  });

test("a finished turn's final reply carries how long the turn worked, from its start to the later of the reply and its last work", () => {
  const earlier = endedTurn([prompt, work("r1", 1000, 2000), reply("a1", 3000)], {
    id: turn,
    startedAt: 500,
  });

  const later = endedTurn([work("r2", 6000, 9000), reply("a2", 8000)], {
    id: asId<"turn">("t2"),
    startedAt: 5000,
  });

  expect(rowsFor([earlier, later]).filter((row) => row.kind === "response")).toMatchObject([
    { key: "response:a1", ended: true, latest: false, workedMs: 2500 },
    { key: "response:a2", ended: true, latest: true, workedMs: 4000 },
  ]);
});

test("a reply with no work before it, or a turn still running, shows no work line", () => {
  const plain = endedTurn([prompt, reply("a1", 3000)], { id: turn });

  const running = endedTurn([work("r2", 6000, 9000), reply("a2", 8000)], {
    id: asId<"turn">("t2"),
    state: { kind: "working", activity: null },
  });

  expect(rowsFor([plain, running], true).filter((row) => row.kind === "response")).toMatchObject([
    { key: "response:a1", ended: true, workedMs: undefined },
    { key: "response:a2", ended: false },
  ]);
});

const COMPLETED_TURN = { kind: "ended", end: { kind: "completed", usage: USAGE } } as const;

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

test("a turn's last step group stays active between its run's steps and leaves the live row blank, but not once its run waits, retries or ends", () => {
  const working = { kind: "working", activity: null } as const;
  const waiting = { kind: "waiting", on: { kind: "timer", until: 9 } } as const;

  const cases = [
    { state: working, messages: [thinking], retrying: undefined, group: true, live: "grouped" },
    {
      state: working,
      messages: [thinking, work("r1", 1, 2)],
      retrying: undefined,
      group: true,
      live: "grouped",
    },
    {
      state: working,
      messages: [work("r1", 1, 2), reply("a1", 3)],
      retrying: undefined,
      group: false,
      live: "planning",
    },
    { state: waiting, messages: [thinking], retrying: undefined, group: false, live: "planning" },
    {
      state: working,
      messages: [thinking],
      retrying: "Overloaded",
      group: false,
      live: "planning",
    },
    {
      state: COMPLETED_TURN,
      messages: [thinking],
      retrying: undefined,
      group: false,
      live: "planning",
    },
  ] as const;

  for (const entry of cases) {
    const rows = transcriptRows({
      loading: false,
      failed: false,
      turns: [endedTurn(entry.messages, { id: turn, state: entry.state })],
      changes: [],
      prompts: [],
      running: true,
      held: false,
      retrying: entry.retrying,
      live: { planning: false, newest: undefined, thought: undefined, awaiting: undefined },
    });

    expect({
      group: rows.some((row) => row.kind === "step" && row.running),
      live: rows.find((row) => row.kind === "live"),
    }).toMatchObject({ group: entry.group, live: { state: entry.live } });
  }
});

test("reasoning that settles while its run waits on the next response keeps its group active", () => {
  const streaming = {
    ...view([prompt, { ...thinking, status: { kind: "live", run: null } }], null),
    turns: [
      endedTurn([], { id: turn, prompt: prompt.id, state: { kind: "working", activity: null } })
        .info,
    ],
    execution: {
      kind: "live",
      run: {
        id: asId<"run">("run"),
        head: asId<"head">("main"),
        startedAt: 1,
        attempt: 1,
        origin: { kind: "input", message: prompt.id },
      },
      phase: "responding",
      stopping: false,
    },
  } satisfies SessionView & { readonly activity: SessionActivity };

  const settled = {
    ...streaming,
    seq: asSeq(2),
    messages: [prompt, thinking],
  } satisfies SessionView & { readonly activity: SessionActivity };

  const projector = transcriptProjector({ thinking: true });

  expect(projector.row({ value: streaming, error: undefined }, "step:th")).toMatchObject({
    running: true,
  });
  expect(projector.row({ value: settled, error: undefined }, "step:th")).toMatchObject({
    running: true,
  });
});

test("the live row plans while the run is idle, names the live thought only where thinking is hidden, and a streamed thought renames it in place", () => {
  const working = {
    ...view([prompt], null),
    turns: [
      endedTurn([], { id: turn, prompt: prompt.id, state: { kind: "working", activity: null } })
        .info,
    ],
    execution: {
      kind: "live",
      run: {
        id: asId<"run">("run"),
        head: asId<"head">("main"),
        startedAt: 1,
        attempt: 1,
        origin: { kind: "input", message: prompt.id },
      },
      phase: "responding",
      stopping: false,
    },
  } satisfies SessionView & { readonly activity: SessionActivity };

  const thought = (markdown: string): Message => ({
    ...thinking,
    state: { markdown, merged: 1, signature: null },
    status: { kind: "live", run: null },
  });

  const thinkingView = {
    ...working,
    activity: { kind: "thinking" },
    messages: [prompt, thought("**Checking the lease**\n\nThe lease")],
  } satisfies SessionView & { readonly activity: SessionActivity };

  const renamed = {
    ...thinkingView,
    seq: asSeq(3),
    messages: [prompt, thought("**Checking the lease**\n\nThe lease\n\n**Reading the helper**")],
  } satisfies SessionView & { readonly activity: SessionActivity };

  const quiet = transcriptProjector({ thinking: false });
  const full = transcriptProjector({ thinking: true });

  const live = (projector: typeof quiet, value: typeof working) =>
    projector.row({ value, error: undefined }, "row:live");

  expect(live(quiet, working)).toMatchObject({
    state: "planning",
    planning: true,
    newest: prompt.id,
    thought: undefined,
  });

  expect(live(quiet, thinkingView)).toMatchObject({
    planning: false,
    thought: "Checking the lease",
  });

  const changedRows = (from: typeof working, to: typeof working) => {
    const before = { value: from, error: undefined };
    const layouts = quiet.rows(before);
    const rows = layouts.map((row) => quiet.row(before, row.key));
    const after = { value: to, error: undefined };

    return [
      quiet.rows(after) === layouts,
      layouts
        .filter((row, index) => quiet.row(after, row.key) !== rows[index])
        .map((row) => row.key),
    ];
  };

  const longer = {
    ...thinkingView,
    seq: asSeq(2),
    messages: [prompt, thought("**Checking the lease**\n\nThe lease length")],
  } satisfies SessionView & { readonly activity: SessionActivity };

  expect(changedRows(thinkingView, longer)).toEqual([true, []]);
  expect(changedRows(longer, renamed)).toEqual([true, ["row:live"]]);
  expect(live(quiet, renamed)).toMatchObject({ thought: "Reading the helper" });
  expect(live(full, renamed)).toMatchObject({ planning: false, thought: undefined });
});

function layout(key: string, group: string | null, sticky = false): RowLayout {
  return { key, group, leads: false, sticky };
}

type Pairs = readonly (readonly [number, number])[];

test.each<[string, readonly RowLayout[], readonly number[], Pairs, Pairs]>([
  [
    "rules 16-17: each turn's prompt spans its turn",
    [layout("p1", "t1", true), layout("a1", "t1"), layout("p2", "t2", true), layout("a2", "t2")],
    [0, 0, 2, 2],
    [
      [0, 1],
      [2, 3],
    ],
    [],
  ],
  [
    "rule 17: a prompt that joined a running turn ends the earlier prompt's span and spans the rest",
    [
      layout("p1", "t1", true),
      layout("a1", "t1"),
      layout("s1", "t1", true),
      layout("live", "t1"),
      layout("summary", null),
    ],
    [0, 0, 2, 2, -1],
    [
      [0, 1],
      [2, 3],
    ],
    [[0, 2]],
  ],
  [
    "rule 16: rows outside a turn hold no prompt, and a pending prompt outside turns never spans",
    [layout("a0", null), layout("p1", "t1", true), layout("queued", null, true)],
    [-1, 1, -1],
    [[1, 1]],
    [],
  ],
  [
    "rule 16: a turn whose prompt isn't sticky holds nothing",
    [layout("report", "t1"), layout("a1", "t1")],
    [-1, -1],
    [],
    [],
  ],
])("%s", (_name, rows, above, ends, handovers) => {
  const spans = stickySpans(rows);

  const sorted = (pairs: ReadonlyMap<number, number>) =>
    [...pairs].toSorted(([first], [second]) => first - second);

  expect([spans.above, sorted(spans.ends), sorted(spans.handovers)]).toEqual([
    above,
    ends,
    handovers,
  ]);
});

const JOINED = new Map([[0, 2]]);

function prompts(earlier: number, joining: number, height = 50): readonly StickyPrompt[] {
  return [
    { index: 0, top: earlier, height },
    { index: 2, top: joining, height },
  ];
}

test.each<[string, readonly StickyPrompt[], ReadonlyMap<number, number>, number | undefined]>([
  ["rule 16: the prompt at the top is stuck", prompts(0, 158), JOINED, 0],
  ["rule 17: the joining prompt at the top takes over", prompts(-74, 0), JOINED, 2],
  [
    "rule 17: while the joining prompt pushes the earlier one off, the earlier one stays stuck",
    prompts(-34, 30),
    JOINED,
    0,
  ],
  ["rule 17: a prompt pushed off by its turn's end is not", prompts(-34, 30), new Map(), undefined],
  ["rule 17: once both have scrolled past, none is", prompts(-200, -80), JOINED, undefined],
  ["rule 18: a prompt as tall as the view never sticks", prompts(0, 158, 700), JOINED, undefined],
])("%s", (_name, shown, handovers, stuck) => {
  expect(stuckPrompt(shown, 700, handovers)).toBe(stuck);
});
