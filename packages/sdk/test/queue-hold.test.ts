import type { SessionView } from "@nyte-ai/schema";
import { lastUserText } from "@nyte-ai/bench";
import type { Reply, Request } from "@nyte-ai/bench";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { connect } from "../src/connect.ts";
import { createSendJournal } from "../src/journal.ts";
import { BASE, TOKEN_SECRET, readOperation, served } from "./served.ts";

interface Gate {
  readonly reached: PromiseWithResolvers<void>;
  readonly open: PromiseWithResolvers<void>;
}

const QUIET_MS = 300;

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.useRealTimers();
});

async function setup() {
  const host = await served();
  cleanups.push(() => host.close());

  const connection = await connect({
    url: BASE,
    credentials: { kind: "token", token: TOKEN_SECRET },
    fetch: host.fetch,
    journal: createSendJournal(),
  });

  cleanups.push(() => connection.close());
  const gates = new Map<string, Gate>();

  cleanups.push(async () => {
    for (const gate of gates.values()) gate.open.resolve();
  });

  const answer = (request: Request): Reply => {
    const gate = gates.get(lastUserText(request));

    return {
      content: [{ type: "text", text: "Done." }],
      tokens: 2,
      async tap(streamed) {
        if (streamed !== 1 || gate === undefined) return;
        gate.reached.resolve();
        await gate.open.promise;
      },
    };
  };

  host.fake.reply(answer, answer, answer, answer);

  return {
    host,
    connection,
    pause: (text: string): Gate => {
      const gate = { reached: Promise.withResolvers<void>(), open: Promise.withResolvers<void>() };
      gates.set(text, gate);

      return gate;
    },
    prompts: () => host.fake.requests.map(lastUserText),
  };
}

function statuses(view: SessionView) {
  return [
    ...view.messages.flatMap((message) =>
      message.kind === "user" ? [[message.content, message.status.kind]] : [],
    ),
    ...view.queue.map((message) => [message.content, message.status.kind]),
  ];
}

function quiet(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, QUIET_MS));
}

describe("revising a queued message", () => {
  it("revises it in place while it waits", async () => {
    const { host, connection, pause, prompts } = await setup();
    const first = pause("First.");
    const { session } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    const third = await session.send("Third.", { delivery: "queue" });

    expect(await session.revise(second.message, "Second, edited.")).toEqual({ kind: "revised" });

    const view = await host.view(session.id);

    expect(statuses(view)).toEqual([
      ["First.", "landed"],
      ["Second, edited.", "pending"],
      ["Third.", "pending"],
    ]);
    expect(view.queue.map((message) => message.id)).toEqual([second.message, third.message]);

    first.open.resolve();

    expect((await third.settled()).kind).toBe("completed");
    expect(prompts()).toEqual(["First.", "Second, edited.", "Third."]);
  });

  it("answers sent once the message started, and leaves its run going", async () => {
    const { host, connection, pause, prompts } = await setup();
    const first = pause("First.");
    const running = pause("Second.");
    const { session } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    first.open.resolve();
    await running.reached.promise;

    expect(await session.revise(second.message, "Second, edited.")).toEqual({ kind: "sent" });

    running.open.resolve();

    expect((await second.settled()).kind).toBe("completed");
    expect(statuses(await host.view(session.id))).toEqual([
      ["First.", "landed"],
      ["Second.", "landed"],
    ]);
    expect(prompts()).toEqual(["First.", "Second."]);
  });
});

describe("holding a queued message", () => {
  it("keeps it and the messages behind it waiting through a revise, until the scope holding it ends", async () => {
    const { host, connection, pause, prompts } = await setup();
    const first = pause("First.");
    const { session, receipt } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    const third = await session.send("Third.", { delivery: "queue" });

    {
      const outcome = await session.hold(second.message);
      assert(outcome.kind === "held");
      await using held = outcome;

      expect(await session.revise(held.message, "Second, edited.")).toEqual({ kind: "revised" });

      first.open.resolve();
      await receipt.settled();
      await quiet();

      expect(statuses(await host.view(session.id))).toEqual([
        ["First.", "landed"],
        ["Second, edited.", "pending"],
        ["Third.", "pending"],
      ]);
      expect(prompts()).toEqual(["First."]);
    }

    expect((await third.settled()).kind).toBe("completed");
    expect(prompts()).toEqual(["First.", "Second, edited.", "Third."]);
  });

  it("runs the saved text once the hold is released, in queue order", async () => {
    const { host, connection, pause, prompts } = await setup();
    const first = pause("First.");
    const { session, receipt } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    const third = await session.send("Third.", { delivery: "queue" });
    const outcome = await session.hold(second.message);
    assert(outcome.kind === "held");
    first.open.resolve();
    await receipt.settled();
    await quiet();

    expect(statuses(await host.view(session.id))).toEqual([
      ["First.", "landed"],
      ["Second.", "pending"],
      ["Third.", "pending"],
    ]);

    expect(await outcome.save("Second, edited.")).toEqual({ kind: "revised" });
    expect((await third.settled()).kind).toBe("completed");
    expect(prompts()).toEqual(["First.", "Second, edited.", "Third."]);
  });

  it("treats release and dispose after a save as done", async () => {
    const { connection, pause, prompts } = await setup();
    const first = pause("First.");
    const { session } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });

    {
      const outcome = await session.hold(second.message);
      assert(outcome.kind === "held");
      await using held = outcome;

      expect(await held.save("Second, edited.")).toEqual({ kind: "revised" });
      expect(await held.release()).toEqual({ kind: "released" });
    }

    first.open.resolve();

    expect((await second.settled()).kind).toBe("completed");
    expect(prompts()).toEqual(["First.", "Second, edited."]);
  });

  it("answers sent once the message started, and leaves its run going", async () => {
    const { host, connection, pause } = await setup();
    const first = pause("First.");
    const running = pause("Second.");
    const { session } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    first.open.resolve();
    await running.reached.promise;

    expect(await session.hold(second.message)).toEqual({ kind: "sent" });

    running.open.resolve();

    expect((await second.settled()).kind).toBe("completed");
    expect(statuses(await host.view(session.id))).toEqual([
      ["First.", "landed"],
      ["Second.", "landed"],
    ]);
  });

  it("loses the hold as sent when a renewal finds the message started", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const { connection, pause } = await setup();
    const first = pause("First.");
    const running = pause("Second.");
    const { session } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    const third = await session.send("Third.", { delivery: "queue" });
    const outcome = await session.hold(second.message);
    assert(outcome.kind === "held");
    await session.hold(third.message);
    first.open.resolve();
    await running.reached.promise;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(await outcome.lost).toEqual({ kind: "sent" });

    running.open.resolve();

    expect((await second.settled()).kind).toBe("completed");
  });

  it("lapses by the lease when a renewal never answers, and still saves and releases", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const { host, connection, pause, prompts } = await setup();
    const first = pause("First.");
    const { session, receipt } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    const outcome = await session.hold(second.message);
    assert(outcome.kind === "held");
    const lost = vi.fn();
    void outcome.lost.then(lost);
    const renewed = Promise.withResolvers<void>();

    host.intercept(async (request, next) => {
      const response = await next(request);

      if (readOperation(request) === "head.hold") renewed.resolve();

      return response;
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await renewed.promise;
    await quiet();
    const renewing = Promise.withResolvers<void>();
    const unanswered = Promise.withResolvers<Response>();

    host.intercept(async (request, next) => {
      if (readOperation(request) !== "head.hold") return next(request);
      renewing.resolve();

      return unanswered.promise;
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await renewing.promise;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(lost).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(await outcome.lost).toEqual({ kind: "lapsed" });
    expect(await outcome.save("Second, edited.")).toEqual({ kind: "revised" });
    expect(await outcome.release()).toEqual({ kind: "lapsing" });

    first.open.resolve();
    await receipt.settled();

    expect((await second.settled()).kind).toBe("completed");
    expect(prompts()).toEqual(["First.", "Second, edited."]);
  });

  it("lets the hold lapse a lease after it was asked for once renewals keep failing, and the queue moves on", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const { host, connection, pause, prompts } = await setup();
    const first = pause("First.");
    const { session, receipt } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    const asked = { reached: Promise.withResolvers<void>(), open: Promise.withResolvers<void>() };

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.hold") {
        asked.reached.resolve();
        await asked.open.promise;
      }

      return next(request);
    });

    const holding = session.hold(second.message);
    await asked.reached.promise;
    await vi.advanceTimersByTimeAsync(12_000);
    asked.open.resolve();
    const outcome = await holding;
    assert(outcome.kind === "held");
    const lost = vi.fn();
    void outcome.lost.then(lost);

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.hold") throw new TypeError("fetch failed");

      return next(request);
    });

    first.open.resolve();
    await receipt.settled();
    await vi.advanceTimersByTimeAsync(5_000);
    await quiet();

    expect(lost).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);

    expect(await outcome.lost).toEqual({ kind: "lapsed" });
    expect(statuses(await host.view(session.id))).toEqual([
      ["First.", "landed"],
      ["Second.", "pending"],
    ]);

    await vi.advanceTimersByTimeAsync(10_000);

    expect((await second.settled()).kind).toBe("completed");
    expect(prompts()).toEqual(["First.", "Second."]);
  });

  it("answers lapsing when the release can't reach the host, and starts the message once the hold lapses", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const { host, connection, pause, prompts } = await setup();
    const first = pause("First.");
    const { session, receipt } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    const outcome = await session.hold(second.message);
    assert(outcome.kind === "held");

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.release") throw new TypeError("fetch failed");

      return next(request);
    });

    expect(await outcome.release()).toEqual({ kind: "lapsing" });

    first.open.resolve();
    await receipt.settled();
    await quiet();

    expect(statuses(await host.view(session.id))).toEqual([
      ["First.", "landed"],
      ["Second.", "pending"],
    ]);
    expect(prompts()).toEqual(["First."]);

    await vi.advanceTimersByTimeAsync(20_000);

    expect((await second.settled()).kind).toBe("completed");
    expect(prompts()).toEqual(["First.", "Second."]);
  });

  it("saves, and ends the scope holding it without throwing, when the release can't reach the host", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    const { host, connection, pause, prompts } = await setup();
    const first = pause("First.");
    const { session, receipt } = await connection.sessions.start({ content: "First." });
    await first.reached.promise;
    const second = await session.send("Second.", { delivery: "queue" });

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.release") throw new TypeError("fetch failed");

      return next(request);
    });

    const edit = async () => {
      const outcome = await session.hold(second.message);
      assert(outcome.kind === "held");
      await using held = outcome;

      return held.save("Second, edited.");
    };

    expect(await edit()).toEqual({ kind: "revised" });

    first.open.resolve();
    await receipt.settled();
    await vi.advanceTimersByTimeAsync(20_000);

    expect((await second.settled()).kind).toBe("completed");
    expect(prompts()).toEqual(["First.", "Second, edited."]);
  });
});
