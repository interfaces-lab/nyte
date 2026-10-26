import { asId, asSeq } from "@nyte-ai/schema";
import type {
  Configuration,
  Delivery,
  DurableEvent,
  HeadInfo,
  HeadName,
  Json,
  PartId,
  PatchEvent,
  PrincipalId,
  RunId,
  SessionId,
  SessionView,
  Usage,
} from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { emptyFold, fold } from "../src/fold/fold.ts";
import { project } from "../src/fold/project.ts";
import type { FoldState } from "../src/contract/fold.ts";

const session: SessionId = asId("s1");

const ada: PrincipalId = asId("ada");

const bob: PrincipalId = asId("bob");

const main: HeadName = asId("main");

const side: HeadName = asId("side");

const configuration: Configuration = {
  kind: "exact",
  model: { provider: "test", id: "model" },
  thinking: "off",
  agent: null,
  settings: {},
  settingsVersion: "1",
};

const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const untouched = { count: 0, paths: [] };

function row(name: HeadName): HeadInfo {
  return {
    name,
    tip: { kind: "start" },
    stack: null,
    execution: { kind: "idle", lastRun: null },
    unread: false,
  };
}

function opened(...heads: HeadName[]): DurableEvent {
  return {
    head: null,
    kind: "session",
    info: {
      id: session,
      name: "triage",
      parent: null,
      call: null,
      workspace: asId("w1"),
      pinned: false,
      archived: false,
      activation: { kind: "active" },
      heads: heads.map(row),
      createdAt: 0,
      lastActivityAt: 0,
    },
  };
}

function admitted(
  message: string,
  delivery: Delivery = "steer",
  replaced: { readonly previous: string; readonly stopped: string } | null = null,
): DurableEvent {
  return {
    head: main,
    kind: "input",
    message: asId(message),
    change: "admitted",
    content: `Say ${message}.`,
    source: { kind: "user" },
    delivery,
    schedule: { kind: "next-turn", reason: "idle" },
    covered: true,
    replaced:
      replaced === null
        ? null
        : { previous: asId(replaced.previous), stopped: asId(replaced.stopped) },
  };
}

function landed(message: string, commit: string, run: string | null): DurableEvent {
  return {
    head: main,
    kind: "input",
    message: asId(message),
    change: "landed",
    commit: asId(commit),
    run: run === null ? null : asId(run),
  };
}

function userCommit(
  id: string,
  message: string,
  parent: string | null,
  siblings: readonly string[] = [],
): DurableEvent {
  return {
    head: main,
    kind: "commit",
    id: asId(id),
    parent: parent === null ? null : asId(parent),
    run: null,
    body: {
      kind: "user",
      message: asId(message),
      content: `Say ${message}.`,
      source: { kind: "user" },
      delivery: "steer",
      siblings: siblings.map((sibling) => asId(sibling)),
    },
  };
}

function started(run: string, message: string, startedAt: number): DurableEvent {
  return {
    head: main,
    kind: "run",
    run: asId(run),
    change: "started",
    view: {
      id: asId(run),
      head: main,
      startedAt,
      attempt: 1,
      origin: { kind: "input", message: asId(message) },
    },
  };
}

function created(
  part: string,
  partKind: string,
  role: "step" | "answer" | "note",
  run: string,
  state: Json,
): DurableEvent {
  return {
    head: main,
    kind: "part",
    part: asId(part),
    change: "created",
    partKind,
    placement: { kind: "transcript", role },
    state,
    version: 1,
    run: asId(run),
    owner: null,
  };
}

function settled(part: string, commit: string, endedAt: number): DurableEvent {
  return {
    head: main,
    kind: "part",
    part: asId(part),
    change: "settled",
    commit: asId(commit),
    endedAt,
  };
}

function partCommit(id: string, part: string, parent: string, run: string): DurableEvent {
  return {
    head: main,
    kind: "commit",
    id: asId(id),
    parent: asId(parent),
    run: asId(run),
    body: { kind: "part", part: asId(part) },
  };
}

function append(part: string, text: string): PatchEvent {
  return { kind: "patch", part: asId(part), append: text };
}

function ended(run: string): DurableEvent {
  return {
    head: main,
    kind: "run",
    run: asId(run),
    change: "ended",
    end: { kind: "completed", usage },
  };
}

function seen(principal: PrincipalId, commit: string): DurableEvent {
  return { head: main, kind: "seen", principal, commit: asId(commit) };
}

function play(state: FoldState, ...events: readonly (DurableEvent | PatchEvent)[]): FoldState {
  let current = state;

  for (const event of events) {
    const seq = current.seq + 1;
    current = fold(
      current,
      event.kind === "patch" ? event : { seq: asSeq(seq), at: seq, ...event },
    );
  }

  return current;
}

function ids(view: SessionView): readonly string[] {
  return view.messages.map((message) => message.id);
}

const read = { kind: "read", path: "src/a.ts" } as const;

const outcome = {
  kind: "ok",
  content: [{ kind: "text", text: "export {};" }],
  output: null,
  parts: [],
} as const;

function turn(message: string, run: string, parent: string | null): readonly DurableEvent[] {
  const commit = `c-${message}`;
  const answer = `${run}:1:0`;

  return [
    admitted(message),
    landed(message, commit, run),
    userCommit(commit, message, parent),
    started(run, message, 0),
    created(answer, "text", "answer", run, { markdown: "", signature: null }),
    settled(answer, `c-${answer}`, 0),
    partCommit(`c-${answer}`, answer, commit, run),
    ended(run),
  ];
}

function answers(run: string, count: number, parent: string): readonly DurableEvent[] {
  return Array.from({ length: count }, (_, index) => {
    const part = `${run}:${String(index + 1)}:0`;

    return [
      created(part, "text", "answer", run, { markdown: "", signature: null }),
      settled(part, `c-${part}`, 0),
      partCommit(`c-${part}`, part, index === 0 ? parent : `c-${run}:${String(index)}:0`, run),
    ];
  }).flat();
}

function longTurn(
  message: string,
  run: string,
  parent: string | null,
  size: number,
  done: boolean,
): readonly DurableEvent[] {
  const commit = `c-${message}`;

  return [
    admitted(message),
    landed(message, commit, run),
    userCommit(commit, message, parent),
    started(run, message, 0),
    ...answers(run, size - 1, commit),
    ...(done ? [ended(run)] : []),
  ];
}

describe("fold", () => {
  it("folds a scripted turn into the view a client draws", () => {
    const empty = emptyFold({ session, principal: ada });

    const catalog = {
      commands: [],
      settings: [],
      skills: [
        {
          name: "review",
          owner: "inputs",
          description: "Review code.",
          location: "/skills/review.md",
        },
      ],
      agents: [],
      tools: [],
    };

    const running = play(
      empty,
      opened(main),
      { head: null, kind: "catalog", catalog },
      { head: main, kind: "configured", selected: configuration, effective: configuration },
      admitted("m1"),
      landed("m1", "c1", "r1"),
      userCommit("c1", "m1", null),
      started("r1", "m1", 7),
      created("r1:1:0", "text", "answer", "r1", { markdown: "", signature: null }),
      append("r1:1:0", "Hel"),
      append("r1:1:0", "lo."),
      settled("r1:1:0", "c2", 9),
      partCommit("c2", "r1:1:0", "c1", "r1"),
      created("call1", "tool", "step", "r1", {
        call: "call1",
        name: "read",
        args: { path: "src/a.ts" },
        class: read,
        phase: "calling",
      }),
      {
        head: main,
        kind: "call",
        call: asId("call1"),
        part: asId("call1"),
        change: "intent",
      },
    );

    expect(project(running, main).execution).toMatchObject({
      kind: "live",
      phase: "responding",
      stopping: false,
    });
    expect(project(running, main).turns[0]?.state).toEqual({
      kind: "working",
      activity: "Exploring",
    });

    const done = play(
      running,
      {
        head: main,
        kind: "call",
        call: asId("call1"),
        part: asId("call1"),
        change: "settled",
        outcome,
        changes: null,
      },
      settled("call1", "c3", 14),
      partCommit("c3", "call1", "c2", "r1"),
      {
        head: main,
        kind: "request",
        model: configuration.model,
        usage,
        context: { tokens: 120, window: 1000, lastRequest: usage },
        step: "assistant",
      },
      ended("r1"),
    );

    const execution = {
      kind: "idle",
      lastRun: { id: "r1", end: { kind: "completed", usage }, endedAt: 17 },
    };

    expect(project(done, main)).toEqual({
      revision: null,
      seq: done.seq,
      activation: { kind: "inactive" },
      messages: [
        {
          id: "m1",
          turn: "m1",
          at: 4,
          kind: "user",
          content: "Say m1.",
          source: { kind: "user" },
          delivery: "steer",
          status: { kind: "landed", commit: "c1", run: "r1", replaced: null },
          siblings: { index: 0, count: 1, ids: ["c1"] },
        },
        {
          id: "r1:1:0",
          turn: "m1",
          at: 8,
          kind: "part",
          part: "r1:1:0",
          partKind: "text",
          role: "answer",
          state: { markdown: "Hello.", signature: null },
          version: 3,
          status: { kind: "settled", commit: "c2", endedAt: 9 },
        },
        {
          id: "call1",
          turn: "m1",
          at: 11,
          kind: "part",
          part: "call1",
          partKind: "tool",
          role: "step",
          state: {
            call: "call1",
            name: "read",
            args: { path: "src/a.ts" },
            class: read,
            phase: "settled",
            outcome,
            changes: null,
          },
          version: 3,
          status: { kind: "settled", commit: "c3", endedAt: 14 },
        },
      ],
      queue: [],
      leadingPrompt: null,
      parts: [],
      turns: [
        {
          id: "m1",
          run: "r1",
          prompt: "m1",
          state: { kind: "ended", end: { kind: "completed", usage } },
          startedAt: 7,
          endedAt: 17,
          steps: 1,
          thinkingOnly: false,
          summary: {
            byClass: {
              read: { count: 1, paths: ["src/a.ts"] },
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
      usage,
      execution,
      reportsHeld: false,
      background: [],
      configuration: { selected: configuration, effective: configuration },
      context: { tokens: 120, window: 1000, lastRequest: usage },
      heads: [
        { name: "main", tip: { kind: "commit", id: "c3" }, stack: null, execution, unread: true },
      ],
      changes: [],
      catalog,
    });
  });

  it("keeps every untouched message, turn and field when a token arrives", () => {
    const before = play(
      emptyFold({ session, principal: ada }),
      opened(main, side),
      ...turn("m0", "r0", null),
      admitted("m1"),
      landed("m1", "c1", "r1"),
      userCommit("c1", "m1", "c-r0:1:0"),
      started("r1", "m1", 0),
      created("r1:1:0", "text", "answer", "r1", { markdown: "", signature: { id: "msg_1" } }),
      append("r1:1:0", "Hel"),
    );

    const earlier = project(before, main);
    const after = fold(before, append("r1:1:0", "lo."));
    const later = project(after, main);

    expect(ids(later)).toEqual(["m0", "r0:1:0", "m1", "r1:1:0"]);
    expect(later.messages[3]).toMatchObject({
      state: { markdown: "Hello.", signature: null },
      version: 3,
    });
    expect(later).not.toBe(earlier);
    expect(later.messages).not.toBe(earlier.messages);
    expect(later.messages.slice(0, 3)).toEqual(earlier.messages.slice(0, 3));
    later.messages
      .slice(0, 3)
      .forEach((message, index) => expect(message).toBe(earlier.messages[index]));
    expect(later.messages[3]).not.toBe(earlier.messages[3]);
    expect(later.turns).toBe(earlier.turns);
    expect(later.heads).toBe(earlier.heads);
    expect(later.catalog).toBe(earlier.catalog);
    expect(after.commits).toBe(before.commits);
    expect(after.turns).toBe(before.turns);
    expect(after.heads.get(side)).toBe(before.heads.get(side));
    expect(project(after, main)).toBe(later);

    const elsewhere = fold(after, {
      seq: asSeq(after.seq + 1),
      at: 0,
      head: side,
      kind: "background",
      item: { kind: "job", id: "j1", title: "Dev server", state: "working", startedBy: null },
    });

    const moved = project(elsewhere, main);

    expect(moved.seq).toBe(elsewhere.seq);
    expect(moved.messages).toBe(later.messages);
    expect(moved.turns).toBe(later.turns);
    expect(project(elsewhere, main)).toBe(moved);
    expect(project(elsewhere, side).background).toHaveLength(1);
    expect(fold(elsewhere, append("missing", "x"))).toBe(elsewhere);
  });

  it("carries exactly the tail, the prompt of the turn it cuts, and the turns its messages belong to", () => {
    const state = play(
      emptyFold({ session, principal: ada }),
      opened(main),
      ...turn("m1", "r1", null),
      ...turn("m2", "r2", "c-r1:1:0"),
    );

    const whole = project(state, main);
    const lead = (tail: number) => project(state, main, { tail }).leadingPrompt?.id ?? null;

    expect(ids(whole)).toEqual(["m1", "r1:1:0", "m2", "r2:1:0"]);
    expect(whole.leadingPrompt).toBeNull();
    expect(ids(project(state, main, { tail: 3 }))).toEqual(["r1:1:0", "m2", "r2:1:0"]);
    expect(lead(3)).toBe("m1");
    expect(ids(project(state, main, { tail: 2 }))).toEqual(["m2", "r2:1:0"]);
    expect(lead(2)).toBeNull();
    expect(ids(project(state, main, { tail: 1 }))).toEqual(["r2:1:0"]);
    expect(lead(1)).toBe("m2");
    expect(project(state, main, { tail: 1 }).leadingPrompt).toBe(whole.messages[2]);
    expect(whole.turns.map((info) => info.id)).toEqual(["m1", "m2"]);
    expect(project(state, main, { tail: 3 }).turns).toBe(whole.turns);
    expect(project(state, main, { tail: 2 }).turns).toEqual([whole.turns[1]]);
    expect(project(state, main, { tail: 2 })).toBe(project(state, main, { tail: 2 }));
    expect(project(state, main, { tail: 0 })).toMatchObject({
      messages: [],
      leadingPrompt: null,
      turns: [],
    });
    expect(project(state, side, { tail: 40 })).toMatchObject({ messages: [], leadingPrompt: null });
    expect(whole.usage).toEqual({ ...usage, input: 20, output: 10, total: 30 });
  });

  it.each([
    { size: 39, first: "r1:1:0", prompt: "m1", turns: ["m1", "m2"] },
    { size: 40, first: "m2", prompt: null, turns: ["m2"] },
    { size: 41, first: "r2:1:0", prompt: "m2", turns: ["m2"] },
    { size: 602, first: "r2:562:0", prompt: "m2", turns: ["m2"] },
  ])(
    "opens a live $size-message turn with 40 contiguous messages and the prompt they cut",
    ({ size, first, prompt, turns }) => {
      const state = play(
        emptyFold({ session, principal: ada }),
        opened(main),
        ...turn("m1", "r1", null),
        ...longTurn("m2", "r2", "c-r1:1:0", size, false),
      );

      const view = project(state, main, { tail: 40 });
      const every = ids(project(state, main, { tail: 1_000 }));

      expect(every).toHaveLength(size + 2);
      expect(view.messages).toHaveLength(40);
      expect(view.messages[0]?.id).toBe(first);
      expect(view.messages.at(-1)?.id).toBe(`r2:${String(size - 1)}:0`);
      expect(ids(view)).toEqual(every.slice(-40));
      expect(view.leadingPrompt?.id ?? null).toBe(prompt);
      expect(view.leadingPrompt?.content ?? null).toBe(prompt === null ? null : `Say ${prompt}.`);
      expect(view.turns.map((info) => info.id)).toEqual(turns);
    },
  );

  it("names the prompt of whichever turn the cutoff falls in when several turns straddle it", () => {
    const state = play(
      emptyFold({ session, principal: ada }),
      opened(main),
      ...longTurn("m1", "r1", null, 15, true),
      ...longTurn("m2", "r2", "c-r1:14:0", 15, true),
      ...longTurn("m3", "r3", "c-r2:14:0", 15, true),
    );

    const window = (tail: number) => {
      const view = project(state, main, { tail });

      return {
        first: view.messages[0]?.id,
        prompt: view.leadingPrompt?.id ?? null,
        turns: view.turns.map((info) => info.id),
      };
    };

    expect(window(40)).toEqual({ first: "r1:5:0", prompt: "m1", turns: ["m1", "m2", "m3"] });
    expect(window(31)).toEqual({ first: "r1:14:0", prompt: "m1", turns: ["m1", "m2", "m3"] });
    expect(window(30)).toEqual({ first: "m2", prompt: null, turns: ["m2", "m3"] });
    expect(window(16)).toEqual({ first: "r2:14:0", prompt: "m2", turns: ["m2", "m3"] });
    expect(window(45)).toEqual({ first: "m1", prompt: null, turns: ["m1", "m2", "m3"] });
  });

  it("invents no prompt for a turn no message started", () => {
    const state = play(
      emptyFold({ session, principal: ada }),
      opened(main),
      ...turn("m1", "r1", null),
      {
        head: main,
        kind: "run",
        run: asId("r2"),
        change: "started",
        view: {
          id: asId("r2"),
          head: main,
          startedAt: 1,
          attempt: 1,
          origin: { kind: "continuation", from: "wake" },
        },
      },
      ...answers("r2", 5, "c-r1:1:0"),
    );

    const view = project(state, main, { tail: 3 });

    expect(ids(view)).toEqual(["r2:3:0", "r2:4:0", "r2:5:0"]);
    expect(view.leadingPrompt).toBeNull();
    expect(view.turns.map((info) => info.id)).toEqual(["run:r2"]);
  });

  it("keeps the same leading prompt while the turn it leads streams on", () => {
    const opening = play(
      emptyFold({ session, principal: ada }),
      opened(main),
      ...longTurn("m1", "r1", null, 602, false),
    );

    const streaming = play(
      opening,
      created("r1:live", "text", "answer", "r1", { markdown: "", signature: null }),
      append("r1:live", "Hel"),
    );

    const grown = play(streaming, append("r1:live", "lo."));
    const before = project(streaming, main, { tail: 40 });
    const after = project(grown, main, { tail: 40 });

    expect(before.messages[0]?.id).toBe("r1:563:0");
    expect(after.messages.at(-1)).toMatchObject({ id: "r1:live", state: { markdown: "Hello." } });
    expect(after.leadingPrompt?.id).toBe("m1");
    expect(after.leadingPrompt).toBe(before.leadingPrompt);
    expect(after.leadingPrompt).toBe(project(opening, main, { tail: 40 }).leadingPrompt);
  });

  it("marks a head unread for the fold's principal only", () => {
    const tip = play(
      emptyFold({ session, principal: ada }),
      opened(main),
      admitted("m1"),
      landed("m1", "c1", null),
      userCommit("c1", "m1", null),
    );

    const unread = (state: FoldState) => project(state, main).heads[0]?.unread;

    expect(unread(tip)).toBe(true);
    expect(unread(play(tip, seen(bob, "c1")))).toBe(true);
    expect(play(tip, seen(bob, "c1")).headInfos).toBe(tip.headInfos);
    expect(unread(play(tip, seen(ada, "c1")))).toBe(false);
    expect(
      unread(
        play(
          tip,
          seen(ada, "c1"),
          admitted("m2"),
          landed("m2", "c2", null),
          userCommit("c2", "m2", "c1"),
        ),
      ),
    ).toBe(true);

    const other = play(
      emptyFold({ session, principal: bob }),
      opened(main),
      admitted("m1"),
      landed("m1", "c1", null),
      userCommit("c1", "m1", null),
      seen(bob, "c1"),
    );

    expect(unread(other)).toBe(false);
  });

  it("drops withdrawn and superseded inputs and reorders the pending ones", () => {
    const pending = play(
      emptyFold({ session, principal: ada }),
      opened(main),
      admitted("m1"),
      admitted("m2", "queue"),
    );

    expect(ids(project(pending, main))).toEqual(["m1", "m2"]);
    expect(project(pending, main).turns).toEqual([]);
    expect(project(pending, main).messages[1]).toMatchObject({
      turn: "pending:m2",
      status: { kind: "pending", schedule: { kind: "next-turn", reason: "idle" }, covered: true },
    });

    const withdrawn = play(pending, {
      head: main,
      kind: "input",
      message: asId("m1"),
      change: "withdrawn",
    });

    expect(ids(project(withdrawn, main))).toEqual(["m2"]);
    expect(project(withdrawn, main).turns).toEqual([]);
    expect(withdrawn.inputs.has(asId("m1"))).toBe(false);

    const superseded = play(withdrawn, admitted("m3"), {
      head: main,
      kind: "input",
      message: asId("m2"),
      change: "superseded",
      by: asId("m3"),
    });

    expect(ids(project(superseded, main))).toEqual(["m3"]);
    expect(superseded.turns.has(asId("pending:m2"))).toBe(false);

    const reordered = play(superseded, admitted("m4"), {
      head: main,
      kind: "input",
      message: asId("m4"),
      change: "scheduled",
      schedule: { kind: "next-turn", reason: "requested" },
      position: 0,
    });

    expect(ids(project(reordered, main))).toEqual(["m3"]);
    expect(project(reordered, main).queue).toMatchObject([
      {
        id: "m4",
        status: { kind: "pending", schedule: { kind: "next-turn", reason: "requested" } },
      },
    ]);
  });

  it("drops the abandoned tail on an edit and counts the edited message's siblings", () => {
    const run: RunId = asId("r1");
    const part: PartId = asId("r1:1:0");
    const failure = { class: "aborted", message: "Stopped." } as const;

    const live = play(
      emptyFold({ session, principal: ada }),
      opened(main),
      admitted("m1"),
      landed("m1", "c1", "r1"),
      userCommit("c1", "m1", null),
      started("r1", "m1", 0),
      created(part, "text", "answer", run, { markdown: "Draft", signature: null }),
    );

    const stopping = play(
      live,
      { head: main, kind: "run", run, change: "stopping" },
      { head: main, kind: "part", part, change: "failed", failure },
    );

    expect(project(stopping, main).execution).toMatchObject({ kind: "live", stopping: true });
    expect(project(stopping, main).messages[1]).toMatchObject({
      status: { kind: "failed", run: "r1", failure },
    });

    const edited = play(
      stopping,
      { head: main, kind: "head", from: asId("c1"), to: null, reason: "moved" },
      admitted("m2", "steer", { previous: "m1", stopped: "r1" }),
      { head: main, kind: "run", run, change: "ended", end: { kind: "stopped" } },
      landed("m2", "c4", null),
      userCommit("c4", "m2", null, ["c1"]),
    );

    expect(ids(project(edited, main))).toEqual(["m2"]);
    expect(project(edited, main).execution).toEqual({
      kind: "idle",
      lastRun: { id: "r1", end: { kind: "stopped" }, endedAt: 11 },
    });
    expect(project(edited, main).messages[0]).toMatchObject({
      status: {
        kind: "landed",
        commit: "c4",
        run: null,
        replaced: { previous: "m1", stopped: "r1" },
      },
      siblings: { index: 1, count: 2, ids: ["c1", "c4"] },
    });

    const back = play(edited, {
      head: main,
      kind: "head",
      from: asId("c4"),
      to: asId("c1"),
      reason: "moved",
    });

    expect(ids(project(back, main))).toEqual(["m1"]);
    expect(project(back, main).messages[0]).toMatchObject({
      siblings: { index: 0, count: 2, ids: ["c1", "c4"] },
    });
  });

  it("settles a committed part that never saw `part settled`, and a failed run leaves it settled", () => {
    const part: PartId = asId("r1:1:0");

    const committed = play(
      emptyFold({ session, principal: ada }),
      opened(main),
      admitted("m1"),
      landed("m1", "c1", "r1"),
      userCommit("c1", "m1", null),
      started("r1", "m1", 0),
      created(part, "text", "answer", "r1", { markdown: "Hi.", signature: null }),
      partCommit("c2", part, "c1", "r1"),
    );

    const status = { kind: "settled", commit: "c2", endedAt: 7 };

    expect(project(committed, main).messages[1]).toMatchObject({ id: part, status });

    const failed = play(committed, {
      head: main,
      kind: "run",
      run: asId("r1"),
      change: "ended",
      end: { kind: "failed", failure: { class: "aborted", message: "Lost." } },
    });

    expect(project(failed, main).messages[1]).toMatchObject({ id: part, status });
  });

  it("leaves execution and the turn alone when a run that is not the head's stops", () => {
    const run: RunId = asId("r1");

    const idle = play(
      emptyFold({ session, principal: ada }),
      opened(main),
      ...turn("m1", "r1", null),
    );

    const before = project(idle, main);

    const after = play(
      idle,
      { head: main, kind: "run", run, change: "stopping" },
      { head: main, kind: "run", run, change: "phase", phase: "executing" },
    );

    expect(project(after, main).execution).toBe(before.execution);
    expect(project(after, main).execution).toMatchObject({ kind: "idle", lastRun: { id: "r1" } });
    expect(project(after, main).turns).toBe(before.turns);
  });
});
