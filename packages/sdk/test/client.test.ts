import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { asId, SdkError } from "@nyte-ai/schema";
import type { WorkspaceId } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import type { Connection } from "@nyte-ai/core";
import { CHANNEL_PATH, encodeError, STREAM_HEADER } from "@nyte-ai/protocol";
import { afterEach, assert, describe, expect, it } from "vitest";
import { connect } from "../src/connect.ts";
import { BASE, readOperation, TOKEN_SECRET, until } from "./served.ts";
import { cleanups, client, closeOpened, open, settledChat, text, users } from "./connection.ts";

afterEach(closeOpened);

describe("client", () => {
  it("starts a session with its first message, settles, and reads a head.view equal to the host's after each step", async () => {
    const host = await open();
    const connection = await client(host);
    host.fake.reply(text("Hello."), text("Again."));

    const { session, receipt } = await connection.sessions.start({
      name: "triage",
      content: "Hi.",
    });

    expect(receipt.id).toBe(asId<"receipt">(session.id));
    expect(receipt.message).toBe(asId<"message">(session.id));
    expect(await receipt.settled()).toMatchObject({ kind: "completed" });
    expect(await receipt.landed()).toMatchObject({ kind: "landed" });
    expect(await receipt.status()).toMatchObject({
      kind: "settled",
      outcome: { kind: "completed" },
    });

    const first = await session.view();

    expect(first).toEqual(await host.view(session.id));
    expect(users(first)).toEqual(["Hi."]);

    await (await session.send("More.", { delivery: "queue" })).settled();
    const second = await session.view();

    expect(users(second)).toEqual(["Hi.", "More."]);
    expect(second).toEqual(await host.view(session.id));
  });

  it("carries the read mark in a head's view once the principal sees the tip", async () => {
    const host = await open();
    const connection = await client(host);
    const session = await settledChat(host, connection);
    const tip = (await session.info()).heads[0]?.tip;
    assert(tip?.kind === "commit");

    expect((await session.view()).seenThrough).toBeNull();
    await session.see(tip.id);
    const seen = await session.view();
    const latest = Math.max(...seen.messages.map((message) => message.at));

    expect(seen.seenThrough).toBeGreaterThanOrEqual(latest);
  });

  it("retries a start whose answer the link lost under the same id, starting one chat", async () => {
    const host = await open();
    const connection = await client(host);
    host.fake.reply(text("Hello."));
    let posts = 0;

    host.intercept(async (request, next) => {
      if (readOperation(request) !== "sessions.start") return next(request);
      posts += 1;
      const response = await next(request);

      if (posts > 1) return response;

      throw new TypeError("fetch failed");
    });

    const { session, receipt } = await connection.sessions.start({ content: "Hi." });

    expect(posts).toBe(2);
    expect(await receipt.settled()).toMatchObject({ kind: "completed" });
    expect((await connection.sessions.list()).items.map((info) => info.id)).toEqual([session.id]);
  });

  it.each([
    { capability: "git", local: false, kind: "unsupported", bound: false },
    { capability: "github", local: false, kind: "unsupported", bound: false },
    { capability: "github", local: true, kind: "available", bound: true },
  ] as const)(
    "answers $capability on a local: $local workspace as $kind, with an api only when available",
    async (row) => {
      const connection = await client(await open({ local: row.local }));
      const info = (await connection.workspaces.list())[0];
      assert(info !== undefined);
      const workspace = connection.workspace(info.id);
      const found = row.capability === "git" ? await workspace.git() : await workspace.github();

      expect({ kind: found.kind, bound: "api" in found }).toEqual({
        kind: row.kind,
        bound: row.bound,
      });
    },
  );

  it("refuses the GitHub account on a host without one", async () => {
    const connection = await client(await open({ local: true }));

    await expect(connection.github.account()).rejects.toMatchObject({ code: "unavailable" });
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
    expect(patches.entries.get("a.txt")).toMatchObject({ path: "a.txt", status: "modified" });

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

  it("binds plugins and principals: a participant is denied, maintenance pairs and lists, a file loads through kernel.plugins.load over the wire and in process", async () => {
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

    const local = await host.host.server
      .connect({
        principal: ops.principal,
        authority: new Set(["maintenance"]),
        credential: { kind: "token", token: "" },
        origin: null,
      })
      .plugins.check([{ path: "/plugins/extra.ts" }]);

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
      readOperation(request) === "sessions.list"
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

  it("skips a frame that fails its schema with a dev line", async () => {
    const host = await open();
    const lines: string[] = [];
    dev.on((line) => lines.push(line));
    cleanups.push(async () => dev.off());
    let streamId: string | null = null;
    let injected = false;

    host.intercept(async (request, next) => {
      if (readOperation(request) === "workspace.watch")
        streamId = request.headers.get(STREAM_HEADER);
      const response = await next(request);

      if (readOperation(request) !== CHANNEL_PATH || response.body === null) return response;

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

    const connection = await client(host);
    const workspace = await readWorkspace(connection);
    const first = await until(connection.workspace(workspace).watch(), () => true);

    expect(first.id).toBe(workspace);
    expect(lines.some((line) => line.startsWith("DEV:sdk frame skipped"))).toBe(true);
  });

  it("ends a watch cleanly when its own reconnect is answered 401, the link closed revoked (ADV C 7)", async () => {
    const host = await open();
    const connection = await client(host);
    let opens = 0;

    host.intercept(async (request, next) =>
      readOperation(request) === "workspace.watch" && ++opens > 1
        ? Response.json(encodeError(new SdkError("unauthenticated", "Revoked.")), { status: 401 })
        : next(request),
    );

    const workspace = await readWorkspace(connection);
    const watching = connection.workspace(workspace).watch()[Symbol.asyncIterator]();
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

    const { receipt } = await connection.sessions.start({
      content: "Hi.",
    });

    const failed = Promise.withResolvers<void>();
    let waits = 0;

    host.intercept(async (request, next) => {
      if (readOperation(request) !== "receipt.settled") return next(request);
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
    const workspace = await readWorkspace(connection);
    const watching = connection.workspace(workspace).watch()[Symbol.asyncIterator]();
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

      if (readOperation(request) !== "files.bytes") return response;

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
    const workspace = await readWorkspace(connection);
    const watching = connection.workspace(workspace).watch()[Symbol.asyncIterator]();
    await watching.next();
    const pending = watching.next();
    await connection.close();

    expect(await pending).toEqual({ done: true, value: undefined });
    await expect(connection.sessions.list()).rejects.toMatchObject({ code: "unavailable" });
  });
});

async function readWorkspace(connection: Connection): Promise<WorkspaceId> {
  const workspace = (await connection.workspaces.list())[0];
  assert(workspace !== undefined);

  return workspace.id;
}
