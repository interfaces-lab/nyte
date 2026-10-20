import { asId, asSeq } from "@nyte-ai/schema";
import type { DurableEvent, HeadName, SessionView } from "@nyte-ai/schema";
import { isPart, text } from "@nyte-ai/core";
import { emptyFold, fold, project } from "@nyte-ai/core/testing";
import { afterEach, assert, expect, it } from "vitest";
import { connect } from "../src/connect.ts";
import { pagedViews } from "../src/history.ts";
import { createSendJournal } from "../src/journal.ts";
import { BASE, TOKEN_SECRET, served } from "./served.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function users(view: SessionView) {
  return view.messages.flatMap((message) => (message.kind === "user" ? [message.content] : []));
}

it("pages a head's older messages and their turns into its views and keeps them while new ones slide the window", async () => {
  const host = await served();
  cleanups.push(() => host.close());

  const connection = await connect({
    url: BASE,
    credentials: { kind: "token", token: TOKEN_SECRET },
    fetch: host.fetch,
    journal: createSendJournal(),
  });

  cleanups.push(() => connection.close());
  host.fake.reply(
    ...["One.", "Two.", "Three.", "Four."].map((text) => ({
      content: [{ type: "text" as const, text }],
    })),
  );
  const { session, receipt } = await connection.sessions.start({ content: "First." });
  await receipt.settled();

  for (const text of ["Second.", "Third."])
    await (await session.send(text, { delivery: "queue" })).settled();

  const views = pagedViews(session, { tail: 3 });
  const iterator = views[Symbol.asyncIterator]();

  const next = async (done: (view: SessionView) => boolean): Promise<SessionView> => {
    for (;;) {
      const step = await iterator.next();
      assert(step.done !== true);

      if (done(step.value)) return step.value;
    }
  };

  try {
    expect(users(await next(() => true))).toEqual(["Third."]);
    expect(await views.earlier(2)).toBe(2);
    expect(users(await next((view) => view.messages.length === 5))).toEqual(["Second.", "Third."]);
    expect(await views.earlier(10)).toBe(1);
    expect(users(await next((view) => view.messages.length === 6))).toEqual([
      "First.",
      "Second.",
      "Third.",
    ]);
    expect(await views.earlier(10)).toBe(0);

    await (await session.send("Fourth.", { delivery: "queue" })).settled();

    const slid = await next(
      (view) => users(view).includes("Fourth.") && view.messages.length === 8,
    );

    expect(users(slid)).toEqual(["First.", "Second.", "Third.", "Fourth."]);
    expect(slid.turns.map((turn) => turn.prompt)).toEqual(
      slid.messages.flatMap((message) => (message.kind === "user" ? [message.id] : [])),
    );

    const quiet = (view: SessionView): boolean =>
      view.execution.kind === "idle" && view.turns.every((turn) => turn.state.kind === "ended");

    const settled = quiet(slid) ? slid : await next(quiet);
    await session.configure({ thinking: "off" });
    const configured = await next((view) => view.configuration !== settled.configuration);

    expect(configured.configuration.selected?.thinking).toBe("off");
    expect(configured.messages).toBe(settled.messages);
    expect(configured.turns).toBe(settled.turns);
  } finally {
    await iterator.return?.();
  }
});

it("pages a turn cut after its prompt with the prompt alongside, every message once, and drops the copy when the prompt itself arrives", async () => {
  const host = await served();
  cleanups.push(() => host.close());

  const connection = await connect({
    url: BASE,
    credentials: { kind: "token", token: TOKEN_SECRET },
    fetch: host.fetch,
    journal: createSendJournal(),
  });

  cleanups.push(() => connection.close());

  const blocks = (prefix: string) => ({
    content: [1, 2, 3, 4, 5].map((index) => ({
      type: "text" as const,
      text: `${prefix}${String(index)}`,
    })),
  });

  host.fake.reply(blocks("a"), blocks("b"), { content: [{ type: "text", text: "c1" }] });
  const { session, receipt } = await connection.sessions.start({ content: "First." });
  await receipt.settled();
  await (await session.send("Second.", { delivery: "queue" })).settled();

  const views = pagedViews(session, { tail: 4 });
  const iterator = views[Symbol.asyncIterator]();

  const next = async (done: (view: SessionView) => boolean): Promise<SessionView> => {
    for (;;) {
      const step = await iterator.next();
      assert(step.done !== true);

      if (done(step.value)) return step.value;
    }
  };

  const shown = (view: SessionView) => ({
    lead: view.leadingPrompt === null ? null : label(view.leadingPrompt),
    messages: view.messages.map(label),
  });

  try {
    expect(shown(await next(() => true))).toEqual({
      lead: "Second.",
      messages: ["b2", "b3", "b4", "b5"],
    });
    expect(await views.earlier(3)).toBe(3);
    const crossed = await next((view) => view.messages.length === 7);
    expect(shown(crossed)).toEqual({
      lead: "First.",
      messages: ["a5", "Second.", "b1", "b2", "b3", "b4", "b5"],
    });
    expect(crossed.turns.map((turn) => turn.prompt)).toEqual([
      crossed.leadingPrompt?.id,
      crossed.messages[1]?.id,
    ]);

    expect(await views.earlier(3)).toBe(3);
    expect(shown(await next((view) => view.messages.length === 10))).toEqual({
      lead: "First.",
      messages: ["a2", "a3", "a4", "a5", "Second.", "b1", "b2", "b3", "b4", "b5"],
    });

    await (await session.send("Third.", { delivery: "queue" })).settled();
    const slid = await next((view) => view.messages.some((message) => label(message) === "c1"));
    expect(shown(slid)).toEqual({
      lead: "First.",
      messages: ["a2", "a3", "a4", "a5", "Second.", "b1", "b2", "b3", "b4", "b5", "Third.", "c1"],
    });

    expect(await views.earlier(10)).toBe(2);
    const whole = await next((view) => view.messages.length === 14);
    expect(shown(whole)).toEqual({
      lead: null,
      messages: [
        "First.",
        "a1",
        "a2",
        "a3",
        "a4",
        "a5",
        "Second.",
        "b1",
        "b2",
        "b3",
        "b4",
        "b5",
        "Third.",
        "c1",
      ],
    });
    expect(whole.messages[0]).toEqual(crossed.leadingPrompt);
    expect(await views.earlier(10)).toBe(0);
  } finally {
    await iterator.return?.();
  }
});

function label(message: SessionView["messages"][number]) {
  if (message.kind === "user") return message.content;

  return isPart(message, text) ? message.state.markdown : message.partKind;
}

it("refreshes a retained leading prompt from the host's newer record of the same prompt", async () => {
  const main: HeadName = asId("main");
  const side: HeadName = asId("side");

  const configuration = {
    kind: "exact",
    model: { provider: "test", id: "model" },
    thinking: "off",
    agent: null,
    settings: {},
    settingsVersion: "1",
  } as const;

  const user = (head: HeadName, message: string): DurableEvent => ({
    head,
    kind: "commit",
    id: asId(`c-${message}`),
    parent: null,
    run: null,
    body: {
      kind: "user",
      message: asId(message),
      content: message,
      source: { kind: "user" },
      delivery: "steer",
      siblings: [],
    },
  });

  const answer = (index: number): readonly DurableEvent[] => {
    const part = `a${String(index)}`;

    return [
      {
        head: main,
        kind: "part",
        part: asId(part),
        change: "created",
        partKind: "text",
        placement: { kind: "transcript", role: "answer" },
        state: { markdown: part, signature: null },
        version: 1,
        run: asId("r1"),
        owner: null,
      },
      {
        head: main,
        kind: "part",
        part: asId(part),
        change: "settled",
        commit: asId(`c-${part}`),
        endedAt: 0,
      },
      {
        head: main,
        kind: "commit",
        id: asId(`c-${part}`),
        parent: asId(index === 1 ? "c-p" : `c-a${String(index - 1)}`),
        run: asId("r1"),
        body: { kind: "part", part: asId(part) },
      },
    ];
  };

  let state = emptyFold({ session: asId("s1"), principal: asId("ada") });

  const play = (...events: readonly DurableEvent[]) => {
    for (const event of events)
      state = fold(state, { seq: asSeq(state.seq + 1), at: state.seq, ...event });

    return project(state, main, { tail: 2 });
  };

  const opening = play(
    {
      head: null,
      kind: "session",
      info: {
        id: asId("s1"),
        name: null,
        parent: null,
        call: null,
        workspace: asId("w1"),
        pinned: false,
        archived: false,
        activation: { kind: "active" },
        heads: [main, side].map((name) => ({
          name,
          tip: { kind: "start" },
          stack: null,
          execution: { kind: "idle", lastRun: null },
          unread: false,
        })),
        createdAt: 0,
        lastActivityAt: 0,
      },
    },
    user(main, "p"),
    {
      head: main,
      kind: "run",
      run: asId("r1"),
      change: "started",
      view: {
        id: asId("r1"),
        head: main,
        startedAt: 0,
        attempt: 1,
        configuration,
        origin: { kind: "input", message: asId("p") },
      },
    },
    ...answer(1),
    ...answer(2),
    ...answer(3),
  );

  const wire: SessionView[] = [opening];
  let deliver: (() => void) | null = null;

  const views = pagedViews({
    watch: () => ({
      async *[Symbol.asyncIterator]() {
        for (let at = 0; ; at += 1) {
          while (wire[at] === undefined) await new Promise<void>((resolve) => (deliver = resolve));
          yield wire[at] ?? opening;
        }
      },
    }),
    history: async () => ({ messages: [], leadingPrompt: null, turns: [] }),
  });

  const iterator = views[Symbol.asyncIterator]();

  const next = async (view: SessionView) => {
    wire.push(view);
    deliver?.();
    const step = await iterator.next();
    assert(step.done !== true);

    return {
      messages: step.value.messages.map(label),
      lead: step.value.leadingPrompt?.id ?? null,
      siblings: step.value.leadingPrompt?.siblings.count ?? null,
    };
  };

  try {
    const first = await iterator.next();
    assert(first.done !== true);
    expect(first.value.messages.map(label)).toEqual(["a2", "a3"]);
    expect(await next(play(...answer(4)))).toEqual({
      messages: ["a2", "a3", "a4"],
      lead: "p",
      siblings: 1,
    });
    expect(await next(play(user(side, "q")))).toEqual({
      messages: ["a2", "a3", "a4"],
      lead: "p",
      siblings: 2,
    });
  } finally {
    await iterator.return?.();
  }
});
