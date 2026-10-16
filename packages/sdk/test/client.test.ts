import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { HostView, SessionView } from "@nyte-ai/schema";
import { SdkError, createConnection, dev, isPart, text as textPart } from "@nyte-ai/core";
import type { Connection } from "@nyte-ai/core";
import { decodeInput, encodeError, parseSse } from "@nyte-ai/protocol";
import { CHANNEL_PATH, STREAM_HEADER, readStreamFrame } from "../../protocol/src/stream-channel.ts";
import { afterEach, assert, describe, expect, it } from "vitest";
import { connect } from "../src/connect.ts";
import { createSendJournal } from "../src/journal.ts";
import { BASE, TOKEN_SECRET, operationOf, served, until } from "./served.ts";
import type { Served } from "./served.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function open(options?: Parameters<typeof served>[0]): Promise<Served> {
  const host = await served(options);
  cleanups.push(() => host.close());

  return host;
}

async function client(host: Served, journal = createSendJournal()): Promise<Connection> {
  const connection = await connect({
    url: BASE,
    credentials: { kind: "token", token: TOKEN_SECRET },
    fetch: host.fetch,
    journal,
  });

  cleanups.push(() => connection.close());

  return connection;
}

function text(markdown: string) {
  return { content: [{ type: "text" as const, text: markdown }] };
}

function users(view: SessionView): readonly string[] {
  return view.messages.flatMap((message) =>
    message.kind === "user" && typeof message.content === "string" ? [message.content] : [],
  );
}

function answer(view: SessionView): string | null {
  const found = view.messages.find((message) => isPart(message, textPart));

  return found !== undefined && isPart(found, textPart) ? found.state.markdown : null;
}

function tapped(
  body: ReadableStream<Uint8Array>,
  seen: (chunk: string, stream: string) => void,
  cut?: {
    readonly after: number;
    readonly kind: "reset" | "end";
    readonly when: (stream: string) => boolean;
  },
): ReadableStream<Uint8Array> {
  let chunks = 0;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const frames = parseSse(body);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await frames.next();
      if (next.done) {
        controller.close();
        return;
      }
      const frame = readStreamFrame(next.value.data);
      const counted = frame.kind === "chunk" && (cut === undefined || cut.when(frame.stream));
      if (cut !== undefined && counted && chunks >= cut.after) {
        if (cut.kind === "reset") controller.error(new TypeError("terminated"));
        else controller.close();
        void frames.return(undefined);
        return;
      }
      if (counted) chunks += 1;
      if (frame.kind === "chunk")
        seen(decoder.decode(Uint8Array.fromBase64(frame.data)), frame.stream);
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(next.value.data)}\n\n`));
    },
    cancel: () => frames.return(undefined).then(() => undefined),
  });
}

describe("client", () => {
  it("creates a session, sends, settles, and folds a head.watch view equal to the host's after each step", async () => {
    const host = await open();
    const connection = await client(host);
    host.fake.reply(text("Hello."), text("Again."));
    const session = await connection.sessions.create({ name: "triage" });
    const watching = session.watch()[Symbol.asyncIterator]();

    const converged = async (): Promise<SessionView> => {
      for (;;) {
        const next = await watching.next();
        assert(next.done !== true);

        if (JSON.stringify(next.value) === JSON.stringify(await host.view(session.id)))
          return next.value;
      }
    };

    const receipt = await session.send("Hi.");

    expect(receipt.message).toBe(receipt.id);
    expect(await receipt.settled()).toMatchObject({ kind: "completed" });
    expect(await receipt.landed()).toMatchObject({ kind: "landed" });
    expect(await receipt.status()).toMatchObject({
      kind: "settled",
      outcome: { kind: "completed" },
    });

    const first = await converged();

    expect(first).toEqual(await host.view(session.id));
    expect(users(first)).toEqual(["Hi."]);

    await (await session.send("More.", { delivery: "queue" })).settled();
    const second = await converged();

    expect(users(second)).toEqual(["Hi.", "More."]);
    expect(second.revision).toBe((await host.view(session.id)).revision);
    expect(await session.view()).toEqual(await host.view(session.id));
    await watching.return?.();
  });

  it("coalesces a burst of token patches into fewer views than patches", async () => {
    const host = await open();
    const connection = await client(host);
    const session = await connection.sessions.create();
    const views: SessionView[] = [];
    let patches = 0;
    const heads = new Set<string>();

    host.intercept(async (request, next) => {
      if (operationOf(request) === "head.watch") {
        const id = request.headers.get(STREAM_HEADER);
        assert(id !== null);
        heads.add(id);
      }
      const response = await next(request);

      if (operationOf(request) !== CHANNEL_PATH || response.body === null) return response;

      return new Response(
        tapped(response.body, (chunk, id) => {
          if (heads.has(id)) patches += chunk.split('"kind":"patch"').length - 1;
        }),
        response,
      );
    });

    host.fake.reply({ content: [{ type: "text", text: "x".repeat(400) }], tokens: 400 });

    const done = until(session.watch(), (view) => {
      views.push(view);

      return view.execution.kind === "idle" && view.messages.length === 2;
    });

    await (await session.send("Stream.")).settled();
    await done;

    expect(patches).toBeGreaterThan(10);
    expect(views.length).toBeLessThan(patches);
    expect(views.at(-1)?.messages.at(-1)).toMatchObject({ state: { markdown: "x".repeat(400) } });
  });

  it.each(["reset", "end", "disconnect"] as const)(
    "resumes a head.watch after a %s with Last-Event-ID: no gap, no repeat, the link reported",
    async (cut) => {
      const host = await open();
      const connection = await client(host);
      host.fake.reply(text("One."), text("Two."));
      const session = await connection.sessions.create();
      await (await session.send("First.")).settled();
      const resumes: (string | null)[] = [];
      const opens: number[][] = [];
      const heads = new Map<string, number[]>();
      let firstHead: string | undefined;

      host.intercept(async (request, next) => {
        if (operationOf(request) === "head.watch") {
          resumes.push(request.headers.get("Last-Event-ID"));
          const id = request.headers.get(STREAM_HEADER);
          assert(id !== null);
          const ids: number[] = [];
          opens.push(ids);
          heads.set(id, ids);
          firstHead ??= id;
        }
        if (operationOf(request) !== CHANNEL_PATH) return next(request);
        const response = await next(request);
        assert(response.body !== null);

        const body = tapped(
          response.body,
          (chunk, id) =>
            heads
              .get(id)
              ?.push(...[...chunk.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))),
          cut !== "disconnect"
            ? { after: 6, kind: cut, when: (id) => id === firstHead }
            : undefined,
        );

        return new Response(body, response);
      });

      const links: HostView["link"]["kind"][] = [];
      const hostViews = connection.watch()[Symbol.asyncIterator]();

      void (async () => {
        for (;;) {
          const next = await hostViews.next();

          if (next.done === true) return;
          links.push(next.value.link.kind);
        }
      })();

      const resumed = until(
        session.watch(),
        async (view) =>
          JSON.stringify(view) === JSON.stringify(await host.view(session.id)) &&
          users(view).length === 2,
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      if (cut === "disconnect") host.listener.disconnectClients();
      await (await session.send("Second.", { delivery: "queue" })).settled();
      const view = await resumed;
      await expect.poll(() => links.at(-1)).toBe("connected");
      await hostViews.return?.();

      expect(opens.length).toBeGreaterThanOrEqual(2);
      expect(resumes[0]).toBeNull();
      const cursor = Number(resumes[1]);
      expect(cursor).toBeGreaterThan(0);
      expect(cursor).toBeLessThanOrEqual(opens[0]?.at(-1) ?? 0);
      expect(opens[1]?.every((id) => id > cursor)).toBe(true);
      expect(users(view)).toEqual(["First.", "Second."]);
      expect(links).toContain("reconnecting");
      expect(links.at(-1)).toBe("connected");
    },
  );

  it("shows a head.watch that starts mid-stream the text streamed before it", async () => {
    const host = await open();
    const writer = await client(host);
    const session = await writer.sessions.create();
    const halfway = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();

    host.fake.reply({
      content: [{ type: "text", text: "abcdefgh" }],
      tokens: 4,
      async tap(streamed) {
        if (streamed !== 2) return;
        halfway.resolve();
        await resume.promise;
      },
    });

    const receipt = await session.send("Go.");
    await halfway.promise;
    const reader = await client(host);
    const late = until(reader.session(session.id).watch(), (view) => answer(view) === "abcd");

    expect(answer(await late)).toBe("abcd");
    resume.resolve();
    await receipt.settled();
  });

  it("resumes a head.watch mid-stream with the text streamed in the gap, none of it twice", async () => {
    const host = await open();
    const connection = await client(host);
    const session = await connection.sessions.create();
    const first = Promise.withResolvers<void>();
    const gap = Promise.withResolvers<void>();
    const paused = Promise.withResolvers<void>();
    const end = Promise.withResolvers<void>();
    let opens = 0;

    host.fake.reply({
      content: [{ type: "text", text: "abcdefgh" }],
      tokens: 4,
      async tap(streamed) {
        if (streamed === 1) {
          first.resolve();
          await gap.promise;
        }

        if (streamed === 3) {
          paused.resolve();
          await end.promise;
        }
      },
    });

    host.intercept(async (request, next) => {
      if (operationOf(request) === "head.watch" && ++opens === 2) {
        gap.resolve();
        await paused.promise;
      }

      return next(request);
    });

    const seen: string[] = [];

    const settled = until(session.watch(), (view) => {
      const markdown = answer(view);

      if (markdown !== null && markdown !== seen.at(-1)) seen.push(markdown);

      if (markdown === "ab") host.listener.disconnectClients();

      if (markdown === "abcdef") end.resolve();

      return view.execution.kind === "idle" && markdown === "abcdefgh";
    });

    const receipt = await session.send("Go.");
    await first.promise;
    await settled;
    await receipt.settled();

    expect(seen).toEqual(["ab", "abcdef", "abcdefgh"]);
  });

  it("keeps a send journaled and shown unsent while the link is down, and lands it once on the next connect", async () => {
    const host = await open();
    const journal = createSendJournal();
    const first = await client(host, journal);
    host.fake.reply(text("Landed."));
    const session = await first.sessions.create();
    let sends = 0;
    let admitted: () => void = () => undefined;

    const reached = new Promise<void>((resolve) => {
      admitted = resolve;
    });

    host.intercept(async (request, next) => {
      if (operationOf(request) !== "head.send") return next(request);
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

    expect(shown.messages.find((message) => message.kind === "user")).toMatchObject({
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
      (view) => view.execution.kind === "idle" && view.messages.length === 2,
    );

    expect(users(settled)).toEqual(["Once."]);
    expect(users(await host.view(session.id))).toEqual(["Once."]);
    expect(await journal.load()).toEqual([]);
  });

  it("rebuilds capabilities: files available with a bound api, git unsupported on a chat-only workspace", async () => {
    const chat = await open();
    const [workspace] = await (await client(chat)).workspaces.list();
    assert(workspace !== undefined);
    const git = await (await client(chat)).workspace(workspace.id).git();

    expect(git.kind).not.toBe("available");
    expect("api" in git).toBe(false);
  });

  it("binds files, git and jobs on a local workspace: bytes, batch uploads, PatchSet maps, job output frames", async () => {
    const host = await open({ local: true });
    const connection = await client(host);
    const [info] = await connection.workspaces.list();
    assert(info !== undefined && host.root !== null);
    const workspace = connection.workspace(info.id);
    const files = await workspace.files();
    assert(files.kind === "available");

    expect(await files.api.write("b.txt", "bee\n")).toMatchObject({ kind: "saved" });
    expect(await files.api.read("b.txt")).toMatchObject({ kind: "text", contents: "bee\n" });

    const reader = await files.api.bytes("b.txt");
    const chunks: Uint8Array[] = [];

    for await (const chunk of reader.chunks()) chunks.push(chunk);
    expect(new TextDecoder().decode(Buffer.concat(chunks))).toBe("bee\n");

    const batch = await files.api
      .batch()
      .put({ path: "c.bin", contents: new Uint8Array([1, 2, 3]) })
      .put({ path: "d.txt", contents: "dee\n" })
      .apply();

    expect(await batch.settled()).toMatchObject({ kind: "applied" });
    expect([...(await readFile(join(host.root, "workspace", "c.bin")))]).toEqual([1, 2, 3]);

    await writeFile(join(host.root, "workspace", "a.txt"), "one\nTWO\n");
    const git = await workspace.git();
    assert(git.kind === "available");
    const patches = await until(git.api.patches({ kind: "worktree" }, ["a.txt"]), () => true);

    expect(patches.entries).toBeInstanceOf(Map);
    expect(patches.entries.get("a.txt")).toBeDefined();

    const job = await workspace.jobs.start({ command: "printf hi" });
    const frames = [];

    for await (const frame of job.output()) frames.push(frame);

    expect(
      new TextDecoder().decode(
        Buffer.concat(frames.flatMap((frame) => (frame.kind === "bytes" ? [frame.data] : []))),
      ),
    ).toBe("hi");
    expect(frames.at(-1)).toEqual({ kind: "exit", code: 0 });
    expect(await job.settled()).toMatchObject({ code: 0 });
  });

  it("shares one fold per head: two watchers open one head.watch and see the same views, and the last leaving closes it", async () => {
    const host = await open();
    const connection = await client(host);
    host.fake.reply(text("Shared."));
    const session = await connection.sessions.create();
    let opened = 0;
    let closed = 0;

    host.intercept(async (request, next) => {
      if (operationOf(request) === "head.watch") opened += 1;
      if (operationOf(request) === CHANNEL_PATH)
        request.signal.addEventListener(
          "abort",
          () => {
            closed += 1;
          },
          { once: true },
        );
      return next(request);
    });

    const done = (view: SessionView): boolean =>
      view.execution.kind === "idle" && view.messages.length === 2;

    const first = until(session.watch(), done);
    const second = until(connection.session(session.id).watch(), done);
    await (await session.send("Both.")).settled();
    const [left, right] = await Promise.all([first, second]);

    expect(opened).toBe(1);
    expect(right).toEqual(left);
    expect(left).toEqual(await host.view(session.id));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(1);
  });

  it("journals a replace of an unsent send as its own row behind it, and resends both after a reconnect (ADV C 2, probe P2)", async () => {
    const host = await open();
    const journal = createSendJournal();
    const first = await client(host, journal);
    host.fake.reply(text("Draft answer."), text("Final answer."));
    const session = await first.sessions.create();
    const lost = Promise.withResolvers<void>();
    let posts = 0;

    host.intercept(async (request, next) => {
      if (operationOf(request) !== "head.send") return next(request);
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

    const id = shown.messages.find((message) => message.kind === "user")?.id;
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
        users(view).join() === "Final." &&
        view.execution.kind === "idle" &&
        view.messages.every(
          (message) => message.kind !== "user" || message.status.kind !== "unsent",
        ),
    );
    expect(users(await host.view(session.id))).toEqual(["Final."]);
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
    host.fake.reply(text("Draft answer."), text("Final answer."));
    const session = await connection.sessions.create();

    const bodies: {
      readonly id: string;
      readonly content: string;
      readonly replace: string | null;
    }[] = [];

    const lost = Promise.withResolvers<void>();

    host.intercept(async (request, next) => {
      if (operationOf(request) !== "head.send") return next(request);
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

    const id = shown.messages.find((message) => message.kind === "user")?.id;
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
      (view) => users(view).join() === "Final." && view.execution.kind === "idle",
    );
    expect(users(await host.view(session.id))).toEqual(["Final."]);
    await expect
      .poll(async () => {
        await session.view();

        return journal.load();
      })
      .toEqual([]);
  });

  it("binds plugins and principals: a participant is denied, maintenance pairs and lists, a file loads through kernel.loadPlugins over the wire and in process", async () => {
    const loaded: string[] = [];

    const host = await open({
      loadPlugins: async (paths) => {
        loaded.push(...paths);

        return paths.map((path) => ({ id: `file:${path}` }));
      },
    });

    const participant = await host.host.principals.pair({ authority: new Set(["participant"]) });
    const maintainer = await host.host.principals.pair({
      authority: new Set(["participant", "maintenance"]),
      label: "ops",
    });

    const as = async (code: string): Promise<Connection> => {
      const connection = await connect({
        url: BASE,
        credentials: { kind: "pairing", code },
        fetch: host.fetch,
      });

      cleanups.push(() => connection.close());

      return connection;
    };

    const denied = await as(participant.code);

    await expect(denied.principals.list()).rejects.toMatchObject({ code: "denied" });
    await expect(denied.plugins.check([{ path: "plugin.ts" }])).rejects.toMatchObject({
      code: "denied",
    });

    const ops = await as(maintainer.code);
    const listed = await ops.principals.list();

    expect(listed.find((view) => view.id === ops.principal)?.authority).toEqual(
      new Set(["participant", "maintenance"]),
    );

    const paired = await ops.principals.pair({ authority: new Set(["participant"]) });

    expect(paired.code).toEqual(expect.any(String));
    await ops.principals.revoke(denied.principal);
    expect((await ops.principals.list()).some((view) => view.id === denied.principal)).toBe(false);

    const remote = await ops.plugins.check([{ path: "/plugins/extra.ts" }]);
    const local = await createConnection(host.host.kernel, {
      principal: ops.principal,
      authority: new Set(["maintenance"]),
      credential: { kind: "token", token: "" },
      origin: null,
    }).plugins.check([{ path: "/plugins/extra.ts" }]);

    expect(loaded).toEqual(["/plugins/extra.ts", "/plugins/extra.ts"]);
    expect(remote.plugins.map((outcome) => outcome.id)).toEqual(["file:/plugins/extra.ts"]);
    expect(local).toEqual(remote);
  });

  it("closes the link revoked on any 401, a plain call included", async () => {
    const host = await open();
    const connection = await client(host);
    const views = connection.watch()[Symbol.asyncIterator]();
    await views.next();

    host.intercept(async (request, next) =>
      operationOf(request) === "sessions.list"
        ? Response.json(encodeError(new SdkError("unauthenticated", "Revoked.")), { status: 401 })
        : next(request),
    );

    await expect(connection.sessions.list()).rejects.toMatchObject({ code: "unauthenticated" });
    const closed = await until(
      { [Symbol.asyncIterator]: () => views },
      (view) => view.link.kind === "closed",
    );

    expect(closed.link).toEqual({ kind: "closed", reason: "revoked" });
    await expect(connection.workspaces.list()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("retries only the replace once the host has the id, and answers with the replace's own receipt (ADV A F6, C 6)", async () => {
    const host = await open();
    const journal = createSendJournal();
    const connection = await client(host, journal);
    host.fake.reply(text("Draft answer."), text("Final answer."));
    const session = await connection.sessions.create();
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
      if (operationOf(request) !== "head.send") return next(request);
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
    const id = shown.messages.find((message) => message.kind === "user")?.id;
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
      (view) => users(view).join() === "Final." && view.execution.kind === "idle",
    );
    expect(users(await host.view(session.id))).toEqual(["Final."]);
    expect(await journal.load()).toEqual([]);
  });

  it("returns from connect before replaying the journal, which lands once the link is back", async () => {
    const host = await open();
    const session = await (await client(host)).sessions.create();
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
      if (operationOf(request) === "head.send" && down) throw new TypeError("fetch failed");

      return next(request);
    });

    const connection = await client(host, journal);
    const unsent = await until(connection.session(session.id).watch(), (view) =>
      view.messages.some((message) => message.kind === "user" && message.status.kind === "unsent"),
    );

    expect(users(unsent)).toEqual(["Journaled."]);
    down = false;

    const landed = await until(
      connection.session(session.id).watch(),
      (view) => view.execution.kind === "idle" && view.messages.length === 2,
    );

    expect(users(landed)).toEqual(["Journaled."]);
    expect(await journal.load()).toEqual([]);
  });

  it("aborts an upload on close", async () => {
    const host = await open({ local: true });
    const connection = await client(host);
    const [info] = await connection.workspaces.list();
    assert(info !== undefined);
    const files = await connection.workspace(info.id).files();
    assert(files.kind === "available");

    const uploading = files.api.upload(
      (async function* () {
        yield new Uint8Array([1]);
        await new Promise(() => undefined);
      })(),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    await connection.close();

    await expect(uploading).rejects.toMatchObject({ code: "unavailable" });
  });

  it("does not retry a send whose answer body fails mid-read: only the fetch call failing is link loss", async () => {
    const host = await open();
    const journal = createSendJournal();
    const connection = await client(host, journal);
    host.fake.reply(text("Once."));
    const session = await connection.sessions.create();
    let posts = 0;

    host.intercept(async (request, next) => {
      if (operationOf(request) !== "head.send") return next(request);
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

  it("skips a frame that fails its schema with a dev line", async () => {
    const host = await open();
    const connection = await client(host);
    const lines: string[] = [];
    dev.on((line) => lines.push(line));
    cleanups.push(async () => dev.off());
    let streamId: string | null = null;
    let injected = false;

    host.intercept(async (request, next) => {
      if (operationOf(request) === "sessions.watch") streamId = request.headers.get(STREAM_HEADER);
      const response = await next(request);

      if (operationOf(request) !== CHANNEL_PATH || response.body === null) return response;

      return new Response(
        response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              if (streamId !== null && !injected) {
                injected = true;
                const data = new TextEncoder().encode('data: "bogus"\n\n').toBase64();
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ kind: "chunk", stream: streamId, data })}\n\n`,
                  ),
                );
              }
              controller.enqueue(chunk);
            },
          }),
        ),
        response,
      );
    });

    const first = await until(connection.sessions.watch(), () => true);

    expect(Array.isArray(first)).toBe(true);
    expect(lines.some((line) => line.startsWith("DEV:sdk frame skipped"))).toBe(true);
  });

  it("points a second rewrite of a landed message at the id the first one's edit answered, before it leaves", async () => {
    const host = await open();
    const journal = createSendJournal();
    const connection = await client(host, journal);
    host.fake.reply(text("One."), text("Two."), text("Three."));
    const session = await connection.sessions.create();
    const first = await session.send("Draft.");
    await first.settled();
    await session.view();
    let down = true;

    host.intercept(async (request, next) => {
      if (operationOf(request) === "head.send" && down) throw new TypeError("fetch failed");

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
    const session = await connection.sessions.create();
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
    await until(session.watch(), (view) => users(view).includes("Second."));
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
      (view) =>
        view.execution.kind === "idle" &&
        users(view).join() === "First.,Second v2." &&
        view.heads.every((head) => !head.unread),
    );

    await watching.return?.();
    await collected;
    expect(
      views.filter((view) => users(view).filter((text) => text.startsWith("Second")).length > 1),
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
    const session = await (await client(host)).sessions.create();
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
      if (operationOf(request) === "head.send" && down) throw new TypeError("fetch failed");

      return next(request);
    });

    const connection = await client(host, journal);

    const unsent = await until(
      connection.session(session.id).watch(),
      (view) => users(view).length === 2,
    );

    expect(users(unsent)).toEqual(["One.", "Two."]);
    expect(
      unsent.messages.map((message) => message.kind === "user" && message.status.kind),
    ).toEqual(["unsent", "unsent"]);
    down = false;
    await until(
      connection.session(session.id).watch(),
      (view) => view.execution.kind === "idle" && view.messages.length === 4,
    );
    expect(users(await host.view(session.id))).toEqual(["One.", "Two."]);
    await expect.poll(() => journal.load()).toEqual([]);
  });

  it("ends a watch cleanly when its own reconnect is answered 401, the link closed revoked (ADV C 7)", async () => {
    const host = await open();
    const connection = await client(host);
    let opens = 0;

    host.intercept(async (request, next) =>
      operationOf(request) === "sessions.watch" && ++opens > 1
        ? Response.json(encodeError(new SdkError("unauthenticated", "Revoked.")), { status: 401 })
        : next(request),
    );

    const watching = connection.sessions.watch()[Symbol.asyncIterator]();
    await watching.next();
    host.listener.disconnectClients();

    expect(await watching.next()).toEqual({ done: true, value: undefined });
    expect(opens).toBe(2);
    await expect(connection.sessions.list()).rejects.toMatchObject({ code: "unavailable" });
  });

  it("stops a wait backing off across link loss as soon as its signal aborts, posting nothing more (ADV C 8)", async () => {
    const host = await open();
    const connection = await client(host);
    host.fake.reply(text("Waited."));
    const session = await connection.sessions.create();
    const receipt = await session.send("Hi.");
    const failed = Promise.withResolvers<void>();
    let waits = 0;

    host.intercept(async (request, next) => {
      if (operationOf(request) !== "receipt.settled") return next(request);
      waits += 1;
      failed.resolve();

      throw new TypeError("fetch failed");
    });

    const controller = new AbortController();
    const settled = receipt.settled({ signal: controller.signal });
    await failed.promise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    controller.abort(new Error("Gave up."));

    await expect(settled).rejects.toThrow("Gave up.");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(waits).toBe(1);
  });

  it("throws a TypeError a watch's reconnect raises instead of reconnecting forever: only the transport's unavailable is link loss (ADV A F15)", async () => {
    const host = await open();
    let broken = false;

    const connection = await connect({
      url: BASE,
      credentials: {
        kind: "custom",
        headers: async () => {
          if (broken) throw new TypeError("A header bug.");

          return { Authorization: `Bearer ${TOKEN_SECRET}` };
        },
      },
      fetch: host.fetch,
    });

    cleanups.push(() => connection.close());
    const watching = connection.sessions.watch()[Symbol.asyncIterator]();
    await watching.next();
    broken = true;
    host.listener.disconnectClients();

    await expect(watching.next()).rejects.toThrow("A header bug.");
  });

  it("returns a new plan from every put and remove: a reviewed plan applies only its own entries (ADV G2, probe P1)", async () => {
    const host = await open({ local: true });
    const connection = await client(host);
    const [info] = await connection.workspaces.list();
    assert(info !== undefined && host.root !== null);
    const files = await connection.workspace(info.id).files();
    assert(files.kind === "available");
    const empty = files.api.batch();
    const a = empty.put({ path: "A.bin", contents: new Uint8Array([1, 2, 3]) });
    const b = a.put({ path: "B.bin", contents: new Uint8Array([4]) }).remove({ path: "a.txt" });

    expect(new Set([empty, a, b]).size).toBe(3);
    expect(await (await a.apply()).settled()).toMatchObject({ kind: "applied" });
    expect([...(await readFile(join(host.root, "workspace", "A.bin")))]).toEqual([1, 2, 3]);
    await expect(readFile(join(host.root, "workspace", "B.bin"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    expect(await readFile(join(host.root, "workspace", "a.txt"), "utf8")).toBe("one\ntwo\n");

    const input = { path: "REVIEWED.txt", contents: "reviewed" };
    const reviewed = empty.put(input);
    input.path = "UNREVIEWED.txt";
    input.contents = "unreviewed";

    expect(await (await reviewed.apply()).settled()).toMatchObject({ kind: "applied" });
    expect(await readFile(join(host.root, "workspace", "REVIEWED.txt"), "utf8")).toBe("reviewed");
    await expect(readFile(join(host.root, "workspace", "UNREVIEWED.txt"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("detaches a job handle's open output on close while the process keeps running (ADV G4, probe P4)", async () => {
    const host = await open({ local: true });
    const connection = await client(host);
    const [info] = await connection.workspaces.list();
    assert(info !== undefined);

    const job = await connection.workspace(info.id).jobs.start({
      command: "printf before; sleep 0.3; printf AFTER_CLOSE",
    });

    const output = job.output()[Symbol.asyncIterator]();
    expect(await output.next()).toMatchObject({ done: false, value: { kind: "bytes" } });
    const pending = output.next();
    await job.close();

    expect(await pending).toEqual({ done: true, value: undefined });
    expect(await job.settled()).toMatchObject({ code: 0 });
  });

  it("ends a byte reader's read in flight on close and cancels its body (ADV G3, probe P6)", async () => {
    const host = await open({ local: true });
    const connection = await client(host);
    const [info] = await connection.workspaces.list();
    assert(info !== undefined);
    const files = await connection.workspace(info.id).files();
    assert(files.kind === "available");
    let cancelled = 0;

    host.intercept(async (request, next) => {
      const response = await next(request);

      if (operationOf(request) !== "files.bytes") return response;

      return new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => controller.enqueue(new Uint8Array([1])),
          cancel: () => {
            cancelled += 1;
          },
        }),
        response,
      );
    });

    const reader = await files.api.bytes("a.txt");
    const chunks = reader.chunks()[Symbol.asyncIterator]();
    expect(await chunks.next()).toEqual({ done: false, value: new Uint8Array([1]) });
    const pending = chunks.next();
    await reader.close();

    expect(await pending).toEqual({ done: true, value: undefined });
    expect(cancelled).toBe(1);
  });

  it("ends every stream and fails requests unavailable once closed", async () => {
    const host = await open();
    const connection = await client(host);
    const session = await connection.sessions.create();
    const watching = session.watch()[Symbol.asyncIterator]();
    await watching.next();
    const pending = watching.next();
    await connection.close();

    expect(await pending).toEqual({ done: true, value: undefined });
    await expect(connection.sessions.list()).rejects.toMatchObject({ code: "unavailable" });
  });
});
