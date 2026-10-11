import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type { HostView, SessionView } from "@nyte-ai/schema";
import { SdkError, createConnection, dev } from "@nyte-ai/core";
import type { Connection } from "@nyte-ai/core";
import { encodeError } from "@nyte-ai/protocol";
import { afterEach, assert, describe, expect, it } from "vitest";
import { connect } from "../src/connect.ts";
import { memoryJournal } from "../src/journal.ts";
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

async function client(host: Served, journal = memoryJournal()): Promise<Connection> {
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

/** Returns a stream's chunks as they pass; with `cut`, after that many chunks it errors (a reset socket) or ends cleanly. */
function tapped(
  body: ReadableStream<Uint8Array>,
  seen: (chunk: string) => void,
  cut?: { readonly after: number; readonly kind: "reset" | "end" },
): ReadableStream<Uint8Array> {
  let chunks = 0;
  const decoder = new TextDecoder();

  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (cut !== undefined && chunks >= cut.after) {
          if (cut.kind === "reset") controller.error(new TypeError("terminated"));
          else controller.terminate();

          return;
        }

        chunks += 1;
        seen(decoder.decode(chunk));
        controller.enqueue(chunk);
      },
    }),
  );
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

    host.intercept(async (request, next) => {
      const response = await next(request);

      if (operationOf(request) !== "head.watch" || response.body === null) return response;

      return new Response(
        tapped(response.body, (chunk) => {
          patches += chunk.split('"kind":"patch"').length - 1;
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

      host.intercept(async (request, next) => {
        if (operationOf(request) !== "head.watch") return next(request);
        resumes.push(request.headers.get("Last-Event-ID"));
        const ids: number[] = [];
        opens.push(ids);
        const response = await next(request);
        assert(response.body !== null);

        const body = tapped(
          response.body,
          (chunk) =>
            ids.push(...[...chunk.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))),
          opens.length === 1 && cut !== "disconnect" ? { after: 6, kind: cut } : undefined,
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

      const ids = opens.flat();

      expect(opens.length).toBeGreaterThanOrEqual(2);
      expect(resumes.slice(0, 2)).toEqual([null, String(opens[0]?.at(-1))]);
      expect(ids).toEqual([...new Set(ids)].sort((a, b) => a - b));
      expect(users(view)).toEqual(["First.", "Second."]);
      expect(links).toContain("reconnecting");
      expect(links.at(-1)).toBe("connected");
    },
  );

  it("keeps a send journaled and shown unsent while the link is down, and lands it once on the next connect", async () => {
    const host = await open();
    const journal = memoryJournal();
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
      if (operationOf(request) !== "head.watch") return next(request);
      opened += 1;
      const response = await next(request);
      assert(response.body !== null);

      return new Response(
        response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            flush: () => {
              closed += 1;
            },
            cancel: () => {
              closed += 1;
            },
          }),
        ),
        response,
      );
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

  it("rewrites the journal row of a send still unsent when a replace names it", async () => {
    const host = await open();
    const journal = memoryJournal();
    const connection = await client(host, journal);
    host.fake.reply(text("Final answer."));
    const session = await connection.sessions.create();
    let down = true;

    host.intercept(async (request, next) => {
      if (operationOf(request) === "head.send" && down) throw new TypeError("fetch failed");

      return next(request);
    });

    const first = session.send("Draft.");
    const unsent = await until(session.watch(), (view) => users(view).includes("Draft."));
    const id = unsent.messages.find((message) => message.kind === "user")?.id;
    assert(id !== undefined);
    const second = session.send("Final.", { replace: id });
    await Promise.resolve();

    expect((await journal.load()).map((entry) => entry.content)).toEqual(["Final."]);
    down = false;
    const [one, two] = await Promise.all([first, second]);

    expect([one.message, two.message]).toEqual([id, id]);
    expect(await two.settled()).toMatchObject({ kind: "completed" });
    expect(users(await host.view(session.id))).toEqual(["Final."]);
    expect(await journal.load()).toEqual([]);
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

  it("retries only the replace once the host has the id, when a rewrite lands mid-post and the link then drops", async () => {
    const host = await open();
    const journal = memoryJournal();
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

    expect([one.message, two.message]).toEqual([id, id]);
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
    const journal = memoryJournal();

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
    const journal = memoryJournal();
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

    host.intercept(async (request, next) => {
      const response = await next(request);

      if (operationOf(request) !== "sessions.watch" || response.body === null) return response;

      return new Response(
        response.body.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            start: (controller) =>
              controller.enqueue(new TextEncoder().encode('data: "bogus"\n\n')),
          }),
        ),
        response,
      );
    });

    const first = await until(connection.sessions.watch(), () => true);

    expect(Array.isArray(first)).toBe(true);
    expect(lines.some((line) => line.startsWith("DEV:sdk frame skipped"))).toBe(true);
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
