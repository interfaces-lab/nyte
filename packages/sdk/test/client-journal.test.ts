import { asId } from "@nyte-ai/schema";
import type { SessionView } from "@nyte-ai/schema";
import { decodeInput } from "@nyte-ai/protocol";
import { afterEach, assert, describe, expect, it } from "vitest";
import { createSendJournal } from "../src/journal.ts";
import { readOperation, until } from "./served.ts";
import { client, closeOpened, open, queued, settledChat, text, users } from "./connection.ts";

afterEach(closeOpened);

describe("client send journal", () => {
  it("keeps a send journaled and shown unsent while the link is down, and lands it once on the next connect", async () => {
    const host = await open();
    const journal = createSendJournal();
    const first = await client(host, journal);
    const session = await settledChat(host, first);
    host.fake.reply(text("Landed."));
    let sends = 0;
    let admitted: () => void = () => undefined;

    const reached = new Promise<void>((resolve) => {
      admitted = resolve;
    });

    host.intercept(async (request, next) => {
      if (readOperation(request) !== "head.send") return next(request);
      sends += 1;

      if (sends === 3) {
        await next(request);
        admitted();
      }

      throw new TypeError("fetch failed");
    });

    const unsent = until(first.session(session.id).watch(), (view) =>
      view.messages.some(
        (message) =>
          message.kind === "user" &&
          message.status.kind === "unsent" &&
          message.status.attempts >= 1,
      ),
    );

    const sending = first.session(session.id).send("Once.");
    const shown = await unsent;

    expect(shown.messages.findLast((message) => message.kind === "user")).toMatchObject({
      content: "Once.",
      status: { kind: "unsent", retrying: { reason: "fetch failed" } },
    });
    expect(await journal.load()).toHaveLength(1);

    await reached;
    await first.close();
    await expect(sending).rejects.toMatchObject({ code: "unavailable" });
    expect(await journal.load()).toHaveLength(1);

    host.intercept(null);
    const second = await client(host, journal);

    const settled = await until(
      second.session(session.id).watch(),
      (view) => view.execution.kind === "idle" && view.messages.length === 4,
    );

    expect(users(settled)).toEqual(["Hi.", "Once."]);
    expect(users(await host.view(session.id))).toEqual(["Hi.", "Once."]);
    expect(await journal.load()).toEqual([]);
  });

  it("journals a replace of an unsent send as its own row behind it, and resends both after a reconnect (ADV C 2, probe P2)", async () => {
    const host = await open();
    const journal = createSendJournal();
    const first = await client(host, journal);
    const session = await settledChat(host, first);
    host.fake.reply(text("Draft answer."), text("Final answer."));
    const lost = Promise.withResolvers<void>();
    let posts = 0;

    host.intercept(async (request, next) => {
      if (readOperation(request) !== "head.send") return next(request);
      posts += 1;

      if (posts === 1) {
        await next(request);
        lost.resolve();
      }

      throw new TypeError("fetch failed");
    });

    const draft = first.session(session.id).send("Draft.");
    await lost.promise;

    const shown = await until(first.session(session.id).watch(), (view) =>
      users(view).includes("Draft."),
    );

    const id = shown.messages.findLast((message) => message.kind === "user")?.id;
    assert(id !== undefined);
    const final = first.session(session.id).send("Final.", { replace: id });
    await expect.poll(async () => (await journal.load()).length).toBe(2);
    const rows = await journal.load();

    expect(rows.map((entry) => [entry.id, entry.content, entry.options.replace ?? null])).toEqual([
      [id, "Draft.", null],
      [expect.not.stringMatching(id), "Final.", id],
    ]);
    await first.close();
    await expect(draft).rejects.toMatchObject({ code: "unavailable" });
    await expect(final).rejects.toMatchObject({ code: "unavailable" });
    expect(await journal.load()).toEqual(rows);

    host.intercept(null);
    const second = await client(host, journal);

    await until(
      second.session(session.id).watch(),
      (view) =>
        users(view).join() === "Hi.,Final." &&
        view.execution.kind === "idle" &&
        view.messages.every(
          (message) => message.kind !== "user" || message.status.kind !== "unsent",
        ),
    );
    expect(users(await host.view(session.id))).toEqual(["Hi.", "Final."]);
    await expect
      .poll(async () => {
        await second.session(session.id).view();

        return journal.load();
      })
      .toEqual([]);
  });

  it("posts every attempt under an id with the content first sent under it, a replace after it under its own id (ADV C 1, probe P1)", async () => {
    const host = await open();
    const journal = createSendJournal();
    const connection = await client(host, journal);
    const session = await settledChat(host, connection);
    host.fake.reply(text("Draft answer."), text("Final answer."));

    const bodies: {
      readonly id: string;
      readonly content: string;
      readonly replace: string | null;
    }[] = [];

    const lost = Promise.withResolvers<void>();

    host.intercept(async (request, next) => {
      if (readOperation(request) !== "head.send") return next(request);
      const body: unknown = await request.clone().json();
      const { content, options } = decodeInput("head.send", body);
      assert(typeof content === "string" && options?.id !== undefined);
      bodies.push({ id: options.id, content, replace: options.replace ?? null });
      const response = await next(request);

      if (bodies.length > 1) return response;
      lost.resolve();

      throw new TypeError("fetch failed");
    });

    const draft = session.send("Draft.");
    await lost.promise;
    const shown = await until(session.watch(), (view) => users(view).includes("Draft."));

    const id = shown.messages.findLast((message) => message.kind === "user")?.id;
    assert(id !== undefined);
    const final = session.send("Final.", { replace: id });
    const [one, two] = await Promise.all([draft, final]);

    expect(bodies.map(({ content, replace }) => [content, replace])).toEqual([
      ["Draft.", null],
      ["Draft.", null],
      ["Final.", id],
    ]);
    expect(bodies.map((body) => body.id === id)).toEqual([true, true, false]);
    expect(one.message).toBe(id);
    expect(two.id).toBe(bodies[2]?.id);
    await until(
      session.watch(),
      (view) => users(view).join() === "Hi.,Final." && view.execution.kind === "idle",
    );
    expect(users(await host.view(session.id))).toEqual(["Hi.", "Final."]);
    await expect
      .poll(async () => {
        await session.view();

        return journal.load();
      })
      .toEqual([]);
  });

  it("retries only the replace once the host has the id, and answers with the replace's own receipt (ADV A F6, C 6)", async () => {
    const host = await open();
    const journal = createSendJournal();
    const connection = await client(host, journal);
    const session = await settledChat(host, connection);
    host.fake.reply(text("Draft answer."), text("Final answer."));
    let posts = 0;
    let release: () => void = () => undefined;
    let arrived: () => void = () => undefined;

    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const posted = new Promise<void>((resolve) => {
      arrived = resolve;
    });

    host.intercept(async (request, next) => {
      if (readOperation(request) !== "head.send") return next(request);
      posts += 1;

      if (posts === 1) {
        arrived();
        await gate;
      } else if (posts <= 3) throw new TypeError("fetch failed");

      return next(request);
    });

    const draft = session.send("Draft.");
    await posted;
    const shown = await until(session.watch(), (view) => users(view).includes("Draft."));
    const id = shown.messages.findLast((message) => message.kind === "user")?.id;
    assert(id !== undefined);
    const final = session.send("Final.", { replace: id });
    await Promise.resolve();
    release();
    const [one, two] = await Promise.all([draft, final]);

    expect(one.message).toBe(id);
    expect(two.message).not.toBe(id);
    expect(posts).toBe(4);
    await until(
      session.watch(),
      (view) => users(view).join() === "Hi.,Final." && view.execution.kind === "idle",
    );
    expect(users(await host.view(session.id))).toEqual(["Hi.", "Final."]);
    expect(await journal.load()).toEqual([]);
  });

  it("returns from connect before replaying the journal, which lands once the link is back", async () => {
    const host = await open();
    const session = await settledChat(host, await client(host));
    host.fake.reply(text("Replayed."));
    const journal = createSendJournal();

    await journal.put({
      id: asId<"receipt">(crypto.randomUUID()),
      session: session.id,
      head: asId<"head">("main"),
      content: "Journaled.",
      options: {},
      at: Date.now(),
    });

    let down = true;

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.send" && down) throw new TypeError("fetch failed");

      return next(request);
    });

    const connection = await client(host, journal);

    const unsent = await until(connection.session(session.id).watch(), (view) =>
      view.queue.some((message) => message.status.kind === "unsent"),
    );

    expect(users(unsent)).toEqual(["Hi."]);
    expect(queued(unsent)).toEqual(["Journaled."]);
    down = false;

    const landed = await until(
      connection.session(session.id).watch(),
      (view) => view.execution.kind === "idle" && view.messages.length === 4,
    );

    expect(users(landed)).toEqual(["Hi.", "Journaled."]);
    expect(await journal.load()).toEqual([]);
  });

  it("does not retry a send whose answer body fails mid-read: only the fetch call failing is link loss", async () => {
    const host = await open();
    const journal = createSendJournal();
    const connection = await client(host, journal);
    const session = await settledChat(host, connection);
    host.fake.reply(text("Once."));
    let posts = 0;

    host.intercept(async (request, next) => {
      if (readOperation(request) !== "head.send") return next(request);
      posts += 1;
      const response = await next(request);

      return posts > 1
        ? response
        : new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => controller.error(new TypeError("terminated")),
            }),
            response,
          );
    });

    await expect(session.send("Hi.")).rejects.toBeInstanceOf(TypeError);
    expect(posts).toBe(1);
    expect(await journal.load()).toEqual([]);
  });

  it("points a second rewrite of a landed message at the id the first one's edit answered, before it leaves", async () => {
    const host = await open();
    const journal = createSendJournal();
    const connection = await client(host, journal);
    host.fake.reply(text("One."), text("Two."), text("Three."));

    const { session, receipt: first } = await connection.sessions.start({
      content: "Draft.",
    });

    await first.settled();
    await session.view();
    let down = true;

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.send" && down) throw new TypeError("fetch failed");

      return next(request);
    });

    const edit = session.send("Final.", { replace: first.message });
    const again = session.send("Final, again.", { replace: first.message });
    await expect.poll(async () => (await journal.load()).length).toBe(2);
    down = false;
    const [edited, twice] = await Promise.all([edit, again]);

    expect(edited.message).not.toBe(first.message);
    expect((await journal.load()).at(-1)?.options.replace).toBe(edited.message);
    await twice.settled();
    await until(
      session.watch(),
      (view) => users(view).join() === "Final, again." && view.execution.kind === "idle",
    );
    expect(users(await host.view(session.id))).toEqual(["Final, again."]);
  });

  it("shows an edit of a queued, acknowledged message once, never unsent beside it, and the view equals the host's after the run (ADV A F1, probe P1)", async () => {
    const host = await open();
    const connection = await client(host);
    const session = await settledChat(host, connection);
    const halfway = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();

    host.fake.reply(
      {
        content: [{ type: "text", text: "abcdefgh" }],
        tokens: 4,
        async tap(streamed) {
          if (streamed !== 1) return;
          halfway.resolve();
          await resume.promise;
        },
      },
      text("Second answer."),
    );

    const first = await session.send("First.");
    await halfway.promise;
    const second = await session.send("Second.", { delivery: "queue" });
    await until(session.watch(), (view) => queued(view).includes("Second."));
    const views: SessionView[] = [];
    const watching = session.watch()[Symbol.asyncIterator]();

    const collected = (async () => {
      for (;;) {
        const next = await watching.next();

        if (next.done === true) return;
        views.push(next.value);
      }
    })();

    const edited = await session.send("Second v2.", { replace: second.message });

    expect(edited.message).toBe(second.message);
    resume.resolve();
    await first.settled();
    await edited.settled();

    const settled = await until(
      session.watch(),
      (view) => view.execution.kind === "idle" && users(view).join() === "Hi.,First.,Second v2.",
    );

    await watching.return?.();
    await collected;
    expect(
      views.filter(
        (view) =>
          [...users(view), ...queued(view)].filter((text) => text.startsWith("Second")).length > 1,
      ),
    ).toEqual([]);
    expect(
      settled.messages.filter(
        (message) => message.kind === "user" && message.status.kind === "unsent",
      ),
    ).toEqual([]);
    expect(settled).toEqual(await host.view(session.id));
  });

  it("holds every journaled entry at connect, all shown unsent before the first lands, then delivers them in order (ADV C 4, probe P5)", async () => {
    const host = await open();
    const session = await settledChat(host, await client(host));
    host.fake.reply(text("One answer."), text("Two answer."));
    const journal = createSendJournal();

    for (const content of ["One.", "Two."])
      await journal.put({
        id: asId<"receipt">(crypto.randomUUID()),
        session: session.id,
        head: asId<"head">("main"),
        content,
        options: { delivery: "queue" },
        at: Date.now(),
      });

    let down = true;

    host.intercept(async (request, next) => {
      if (readOperation(request) === "head.send" && down) throw new TypeError("fetch failed");

      return next(request);
    });

    const connection = await client(host, journal);

    const unsent = await until(
      connection.session(session.id).watch(),
      (view) => users(view).length + queued(view).length === 3,
    );

    expect([...users(unsent), ...queued(unsent)].toSorted()).toEqual(["Hi.", "One.", "Two."]);
    expect(
      [...unsent.messages, ...unsent.queue].flatMap((message) =>
        message.kind === "user" ? [message.status.kind] : [],
      ),
    ).toEqual(["landed", "unsent", "unsent"]);
    down = false;
    await until(
      connection.session(session.id).watch(),
      (view) => view.execution.kind === "idle" && view.messages.length === 6,
    );
    expect(users(await host.view(session.id))).toEqual(["Hi.", "One.", "Two."]);
    await expect.poll(() => journal.load()).toEqual([]);
  });
});

it("leaves a send the host admitted but never answered to the clipped prompt that shows it, once, and lands it there", async () => {
  const host = await open();
  const journal = createSendJournal();
  const connection = await client(host, journal);
  const session = await settledChat(host, connection);
  let sends = 0;

  host.fake.reply({
    content: [1, 2, 3, 4, 5].map((index) => ({ type: "text" as const, text: `a${String(index)}` })),
  });

  host.intercept(async (request, next) => {
    if (readOperation(request) !== "head.send") return next(request);
    sends += 1;

    if (sends === 1) await next(request);

    throw new TypeError("fetch failed");
  });

  void connection
    .session(session.id)
    .send("Clipped.")
    .catch(() => undefined);

  const clipped = await until(
    connection.session(session.id).watch({ tail: 2 }),
    (view) =>
      view.execution.kind === "idle" &&
      view.leadingPrompt !== null &&
      view.messages.every((message) => message.kind === "part"),
  );

  expect(clipped.leadingPrompt).toMatchObject({ content: "Clipped.", status: { kind: "landed" } });
  expect(clipped.messages.map((message) => message.kind)).toEqual(["part", "part"]);
  expect(await journal.load()).toHaveLength(1);

  await connection.close();
  host.intercept(null);
  const reconnected = await client(host, journal);
  const watching = reconnected.session(session.id).watch({ tail: 2 })[Symbol.asyncIterator]();
  const first = await watching.next();

  await expect.poll(() => journal.load(), { timeout: 3_000 }).toEqual([]);
  await watching.return?.();
  assert(first.done !== true);
  const landed = first.value;
  expect(landed.messages.map((message) => message.kind)).toEqual(["part", "part"]);
  expect(landed.leadingPrompt?.id).toBe(clipped.leadingPrompt?.id);
});
