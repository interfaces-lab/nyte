import { asId, SdkError } from "@nyte-ai/schema";
import type { SessionView } from "@nyte-ai/schema";
import type { Connection } from "@nyte-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { connect } from "../src/connect.ts";
import { createSendJournal } from "../src/journal.ts";
import { BASE, TOKEN_SECRET, operationOf, served, until } from "./served.ts";
import type { Served } from "./served.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup().catch(() => undefined);
});

async function open(): Promise<Served> {
  const host = await served();
  cleanups.push(() => host.close());

  return host;
}

async function client(
  host: Served,
  credentials: Parameters<typeof connect>[0]["credentials"] = {
    kind: "token",
    token: TOKEN_SECRET,
  },
  journal = createSendJournal(),
): Promise<Connection> {
  const connection = await connect({ url: BASE, credentials, fetch: host.fetch, journal });
  cleanups.push(() => connection.close());

  return connection;
}

function text(markdown: string) {
  return { content: [{ type: "text" as const, text: markdown }] };
}

function users(view: SessionView): readonly string[] {
  return view.messages.flatMap((message) =>
    message.kind === "user" && typeof message.content === "string"
      ? [`${message.content}#${message.status.kind}`]
      : [],
  );
}

function paused(host: Served, ...rest: string[]) {
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
    ...rest.map(text),
  );

  return { halfway: halfway.promise, resume: () => resume.resolve() };
}

const failing = async (request: Request, next: (request: Request) => Promise<Response>) => {
  if (operationOf(request) === "head.send") throw new TypeError("fetch failed");

  return next(request);
};

describe("edits", () => {
  it("lands a revise of a queued message once: its own id resent after the message landed replays the target's receipt, and the target's own send still replays (ADV A N1, probe /tmp/adv-a2 N1)", async () => {
    const host = await open();
    const connection = await client(host);
    const session = await connection.sessions.create();
    const script = paused(host, "Second answer.", "Third answer.");
    const first = await session.send("First.");
    await script.halfway;
    const second = await session.send("Second.", { delivery: "queue" });
    const R = asId<"receipt">(crypto.randomUUID());
    const revised = await session.send("Second v2.", { replace: second.message, id: R });
    script.resume();
    await first.settled();
    await revised.settled();
    await (await session.send("Third.")).settled();
    const before = await host.view(session.id);
    const requests = host.fake.requests.length;

    const retried = await session.send("Second v2.", { replace: second.message, id: R });
    const replayed = await session.send("Second.", {
      delivery: "queue",
      id: asId<"receipt">(second.message),
    });

    expect(revised.message).toBe(second.message);
    expect(retried.message).toBe(second.message);
    expect(replayed.message).toBe(second.message);
    expect(await host.view(session.id)).toEqual(before);
    expect(users(before)).toEqual(["First.#landed", "Second v2.#landed", "Third.#landed"]);
    expect(host.fake.requests.length).toBe(requests);
  });

  it("replays a journaled revise on the next connect without editing the head again (ADV A N1, probe /tmp/adv-a2 N1-sdk)", async () => {
    const host = await open();
    const journal = createSendJournal();
    const connection = await client(host, undefined, journal);
    const session = await connection.sessions.create();
    const script = paused(host, "Second answer.", "Third answer.", "Again.");
    const first = await session.send("First.");
    await script.halfway;
    const second = await session.send("Second.", { delivery: "queue" });
    const revised = await session.send("Second v2.", { replace: second.message });
    script.resume();
    await first.settled();
    await revised.settled();
    await (await session.send("Third.")).settled();
    const before = await host.view(session.id);
    const requests = host.fake.requests.length;
    await connection.close();
    let posts = 0;

    host.intercept(async (request, next) => {
      if (operationOf(request) === "head.send") posts += 1;

      return next(request);
    });

    const again = await client(host, undefined, journal);
    const watching = again.session(session.id).watch()[Symbol.asyncIterator]();
    await watching.next();
    await expect.poll(async () => (await journal.load()).length).toBe(0);
    await watching.return?.();
    const after = await host.view(session.id);

    expect(posts).toBe(4);
    expect([after.revision, users(after)]).toEqual([before.revision, users(before)]);
    expect(users(before)).toEqual(["First.#landed", "Second v2.#landed", "Third.#landed"]);
    expect(host.fake.requests.length).toBe(requests);
  });

  it("shows an edit of a landed message unsent in its place in view() and watch() while it retries (ADV C N1 = A N7, probe /tmp/adversarial-c2-probe J2)", async () => {
    const host = await open();
    const journal = createSendJournal();
    const connection = await client(host, undefined, journal);
    host.fake.reply(text("One."), text("Two."));
    const session = await connection.sessions.create();
    const first = await session.send("Draft.");
    await first.settled();
    await session.view();
    host.intercept(failing);
    const edit = session.send("Final.", { replace: first.message });
    await expect.poll(async () => (await journal.load()).length).toBe(1);

    expect(users(await session.view())).toEqual(["Final.#unsent"]);
    expect(users(await until(session.watch(), () => true))).toEqual(["Final.#unsent"]);
    host.intercept(null);
    await (await edit).settled();
    expect(users(await until(session.watch(), (view) => view.execution.kind === "idle"))).toEqual([
      "Final.#landed",
    ]);
  });

  it("keeps an edit of a landed message unsent in its place across a revoke and a re-pair, until it lands (ADV C N1, probe /tmp/adversarial-c2-probe J2b)", async () => {
    const host = await open();
    const owner = await client(host);
    host.fake.reply(text("One."), text("Two."));
    const session = await owner.sessions.create();
    const journal = createSendJournal();
    const one = await host.host.principals.pair({ authority: new Set(["participant"]) });
    const first = await client(host, { kind: "pairing", code: one.code }, journal);
    const sent = await first.session(session.id).send("Draft.");
    await sent.settled();
    await first.session(session.id).view();
    host.intercept(failing);
    const edit = first.session(session.id).send("Final.", { replace: sent.message });
    await expect.poll(async () => (await journal.load()).length).toBe(1);

    expect(users(await first.session(session.id).view())).toEqual(["Final.#unsent"]);
    await host.host.principals.revoke(first.principal);
    host.intercept(null);
    await expect(edit).rejects.toBeInstanceOf(SdkError);
    expect((await journal.load()).map((entry) => entry.content)).toEqual(["Final."]);
    const two = await host.host.principals.pair({ authority: new Set(["participant"]) });
    host.intercept(failing);
    const second = await client(host, { kind: "pairing", code: two.code }, journal);

    expect(users(await second.session(session.id).view())).toEqual(["Final.#unsent"]);
    host.intercept(null);
    await until(
      second.session(session.id).watch(),
      (view) => users(view).join() === "Final.#landed" && view.execution.kind === "idle",
    );
    expect(users(await host.view(session.id))).toEqual(["Final.#landed"]);
  });

  it("admits every plain send racing on one head from several clients: a lost inbox write is retried, never answered stale (ADV A N5, probe /tmp/adv-a2 N8)", async () => {
    const host = await open();
    const clients = await Promise.all(Array.from({ length: 6 }, () => client(host)));
    const session = await clients[0].sessions.create();
    const texts = clients.map((_, index) => `Send ${index}.`);

    const sent = await Promise.allSettled(
      clients.map((connection, index) =>
        connection.session(session.id).send(texts[index], { delivery: "attach" }),
      ),
    );

    expect(sent.map((result) => result.status)).toEqual(texts.map(() => "fulfilled"));
    const pending = await host.view(session.id);
    expect([...users(pending)].sort()).toEqual(texts.map((entry) => `${entry}#pending`));
  });
});
