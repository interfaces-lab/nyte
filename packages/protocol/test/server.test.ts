import { asId, standard } from "@nyte-ai/schema";
import type { HeadName } from "@nyte-ai/schema";
import {
  SdkError,
  decodeSeenRecord,
  definePart,
  dev,
  headRef,
  memoryStore,
  seenRef,
} from "@nyte-ai/core";
import type { Store, StoreConnection } from "@nyte-ai/core";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import {
  HOST_HEADER,
  decodeError,
  decodeOutput,
  parseOutputFrames,
  parseSse,
  withInputHeader,
} from "../src/index.ts";
import type { SseFrame } from "../src/index.ts";
import { parseJson } from "../src/json.ts";
import { endless, post, served } from "./fakes.ts";

const main: HeadName = asId("main");

const question = definePart({
  kind: "test/question",
  state: standard(Type.Object({ title: Type.String() })),
  actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
  fallback: (state) => state.title,
});

async function errorOf(response: Response) {
  return decodeError(parseJson(await response.text()), response.status);
}

async function until(
  response: Response,
  done: (frame: SseFrame) => boolean,
): Promise<readonly SseFrame[]> {
  const frames: SseFrame[] = [];

  assert(response.body !== null);

  for await (const frame of parseSse(response.body)) {
    frames.push(frame);

    if (done(frame)) break;
  }

  return frames;
}

function kindOf(frame: SseFrame): string | null {
  const data = frame.data;

  return typeof data === "object" &&
    data !== null &&
    "kind" in data &&
    typeof data.kind === "string"
    ? data.kind
    : null;
}

function changed(change: (opened: StoreConnection) => StoreConnection): Store {
  const base = memoryStore();

  return { ...base, open: async () => change(await base.open()) };
}

async function sent(handler: (request: Request) => Promise<Response>) {
  const created = decodeOutput(
    "sessions.create",
    await (await post(handler, "sessions.create", {})).json(),
  );
  const receipt = decodeOutput(
    "head.send",
    await (
      await post(handler, "head.send", { session: created.session, head: main, content: "Hi." })
    ).json(),
  );

  return { session: created.session, ...receipt };
}

describe("handler", () => {
  it("creates, sends, streams the session's events with ids on logged ones, and settles", async () => {
    const { handler, fake, host } = await served();
    fake.reply("Hello there.");
    const { session, receipt } = await sent(handler);
    const settled = await post(handler, "receipt.settled", { session, receipt });

    expect(settled.status).toBe(200);
    expect(decodeOutput("receipt.settled", await settled.json())).toMatchObject({
      kind: "completed",
    });

    const watch = await post(handler, "head.watch", { session, head: main });

    expect(watch.headers.get("Content-Type")).toBe("text/event-stream");
    const frames = await until(watch, (frame) => kindOf(frame) === "catalog");
    const logged = frames.filter((frame) => frame.id !== null);

    expect(logged.length).toBeGreaterThan(3);

    for (const frame of logged) expect(frame.data).toMatchObject({ seq: Number(frame.id) });
    expect(frames.slice(-2).map((frame) => [kindOf(frame), frame.id])).toEqual([
      ["activation", null],
      ["catalog", null],
    ]);
    expect(frames.map(kindOf)).toContain("run");
    expect(frames.some((frame) => JSON.stringify(frame.data).includes('"change":"ended"'))).toBe(
      true,
    );
    await expect
      .poll(() => host.kernel.store.refs.get(seenRef(session, asId("ada"), main)))
      .not.toBeNull();
  });

  it("sends each head's ref pair first and after each commit, with no id (§40s, §54a)", async () => {
    const { handler, fake, host } = await served();
    fake.reply("Landed.");
    const { session, receipt } = await sent(handler);
    await post(handler, "receipt.settled", { session, receipt });
    const ref = await host.kernel.store.refs.get(headRef(session, main));
    const frames = await until(
      await post(handler, "head.watch", { session, head: main }),
      (frame) => kindOf(frame) === "catalog",
    );
    const landing = frames.findIndex(
      (frame) => kindOf(frame) === "commit" && JSON.stringify(frame.data).includes('"kind":"user"'),
    );
    const pair = { kind: "revision", head: main, tip: ref?.target, revision: ref?.revision };

    assert(ref !== null && landing > 0);
    expect(frames[0]).toEqual({ id: null, data: pair });
    expect(frames[landing + 1]).toEqual({ id: null, data: pair });
    expect(
      frames.every(
        (frame, index) =>
          kindOf(frame) !== "commit" || kindOf(frames[index + 1] ?? frame) === "revision",
      ),
    ).toBe(true);
  });

  it("sends the watched head's pair as the first frame, not another head's (§54a)", async () => {
    const { handler, fake, host } = await served();
    fake.reply("Landed.");
    const { session, receipt } = await sent(handler);
    await post(handler, "receipt.settled", { session, receipt });
    const side: HeadName = asId("side");
    await host.session(session).heads.create(side);
    const ref = await host.kernel.store.refs.get(headRef(session, side));
    const frames = await until(
      await post(handler, "head.watch", { session, head: side }),
      (frame) => kindOf(frame) === "catalog",
    );

    assert(ref !== null);
    expect(frames[0]?.data).toEqual({
      kind: "revision",
      head: side,
      tip: ref.target,
      revision: ref.revision,
    });
    expect(kindOf(frames[1] ?? { id: null, data: null })).not.toBe("revision");
  });

  it("resumes a watch after Last-Event-ID from the log", async () => {
    const { handler, fake } = await served();
    fake.reply("One.");
    const { session, receipt } = await sent(handler);
    await post(handler, "receipt.settled", { session, receipt });

    const first = await until(
      await post(handler, "head.watch", { session, head: main }),
      (frame) => kindOf(frame) === "catalog",
    );
    const ids = first.flatMap((frame) => (frame.id === null ? [] : [frame.id]));
    const resume = ids[2];

    assert(resume !== undefined);
    const resumed = await until(
      await post(handler, "head.watch", { session, head: main }, { "Last-Event-ID": resume }),
      (frame) => kindOf(frame) === "catalog",
    );

    const replayed = resumed.flatMap((frame) => (frame.id === null ? [] : [frame.id]));

    expect(replayed.slice(0, ids.length - 3)).toEqual(ids.slice(3));
    expect(
      replayed.slice(ids.length - 3).map((id) => resumed.find((frame) => frame.id === id)?.data),
    ).toEqual([expect.objectContaining({ kind: "seen", principal: "ada" })]);
  });

  it("moves the seen mark for tips forwarded live, never for replayed history (§40x)", async () => {
    const { handler, fake, host } = await served();
    fake.reply("One.", "Two.");
    const { session, receipt } = await sent(handler);
    await post(handler, "receipt.settled", { session, receipt });

    const again = decodeOutput(
      "head.send",
      await (await post(handler, "head.send", { session, head: main, content: "Again." })).json(),
    );

    await post(handler, "receipt.settled", { session, receipt: again.receipt });

    const tip = (await host.kernel.store.refs.get(headRef(session, main)))?.target;

    const seen = async () => {
      const target =
        (await host.kernel.store.refs.get(seenRef(session, asId("ada"), main)))?.target ?? null;

      return target === null
        ? null
        : decodeSeenRecord(await host.kernel.store.objects.get(target))?.commit;
    };

    await until(
      await post(handler, "head.watch", { session, head: main }),
      (frame) => kindOf(frame) === "catalog",
    );
    await expect.poll(seen).toBe(tip);

    const controller = new AbortController();

    const replayed = await until(
      await post(handler, "head.watch", { session, head: main }, undefined, controller.signal),
      (frame) => kindOf(frame) === "commit",
    );

    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(replayed.at(-1)?.data).not.toMatchObject({ id: tip });
    expect(await seen()).toBe(tip);
  });

  it("writes a dev line when a seen mark fails, instead of swallowing it (ADV C 9)", async () => {
    const store = changed((opened) => ({
      ...opened,
      refs: {
        ...opened.refs,
        set: async (updates) =>
          updates.some((update) => update.event?.kind === "seen")
            ? Promise.reject(new Error("The seen write was refused."))
            : opened.refs.set(updates),
      },
    }));
    const { handler, fake } = await served({ store });
    const lines: string[] = [];
    const sink = dev.sink;
    dev.on((line) => {
      lines.push(line);
    });

    try {
      fake.reply("Seen.");
      const { session, receipt } = await sent(handler);
      await post(handler, "receipt.settled", { session, receipt });
      await until(
        await post(handler, "head.watch", { session, head: main }),
        (frame) => kindOf(frame) === "catalog",
      );

      await expect
        .poll(() => lines.filter((line) => line.startsWith("DEV:binding seen failed")))
        .toEqual([`DEV:binding seen failed {"session":"${session}","head":"main"}`]);
    } finally {
      dev.sink = sink;
    }
  });

  it("closes a raw byte body and its provider reader when the request aborts (ADV G P5)", async () => {
    const reader = endless();
    const store = changed((opened) => ({
      ...opened,
      objects: { ...opened.objects, blob: async () => reader },
    }));
    const { handler } = await served({ store });
    const controller = new AbortController();
    const response = await post(handler, "connection.blob", { id: "b1" }, {}, controller.signal);
    const body = response.body?.getReader();

    assert(body !== undefined);
    expect((await body.read()).value).toEqual(Uint8Array.of(7));
    controller.abort();

    await expect(body.read()).rejects.toThrow();
    expect(reader.closes()).toBe(1);
  });

  it("ends an upload in flight when its request aborts, as the listener's close does, writing nothing after (ADV G9, probe N1)", async () => {
    for (const name of ["files.upload", "files.write"] as const) {
      const { handler, workspace, disk } = await served();
      const ready = Promise.withResolvers<void>();
      const finish = Promise.withResolvers<void>();
      let cancelled = 0;
      let started = false;

      const input = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (started) {
            await finish.promise;
            controller.close();

            return;
          }

          started = true;
          controller.enqueue(Uint8Array.of(7));
          ready.resolve();
        },
        cancel() {
          cancelled += 1;
          finish.resolve();
        },
      });

      const controller = new AbortController();
      const init = withInputHeader(
        name === "files.upload" ? { workspace } : { workspace, path: "AFTER_CLOSE" },
        input,
      );

      const pending = handler(
        new Request(`http://host.test/${name}`, {
          ...init,
          headers: { ...init.headers, Authorization: "Bearer owner" },
          signal: controller.signal,
        }),
      );

      await ready.promise;
      controller.abort(new SdkError("unavailable", "The host disconnected its clients."));
      const response = await pending;
      finish.resolve();

      expect([name, response.status, (await errorOf(response)).code]).toEqual([
        name,
        503,
        "unavailable",
      ]);
      expect(cancelled).toBe(1);
      expect([...disk.keys()]).toEqual([]);
    }
  });

  it("ends a stream with its abort's SdkError, so a client revoked here reads unauthenticated (ADV C N2)", async () => {
    const { handler } = await served();
    const { session } = decodeOutput(
      "sessions.create",
      await (await post(handler, "sessions.create", {})).json(),
    );
    const controller = new AbortController();
    const response = await post(
      handler,
      "head.watch",
      { session, head: main },
      {},
      controller.signal,
    );

    assert(response.body !== null);
    const frames = parseSse(response.body)[Symbol.asyncIterator]();
    let frame = await frames.next();

    while (frame.done !== true && kindOf(frame.value) !== "catalog") frame = await frames.next();
    controller.abort(new SdkError("unauthenticated", "The principal was revoked."));

    await expect(
      (async () => {
        while ((await frames.next()).done !== true);
      })(),
    ).rejects.toMatchObject({ code: "unauthenticated", message: "The principal was revoked." });
  });

  it("routes exactly POST /<name>, a prefix being the host's mount (§40x)", async () => {
    const { handler } = await served();
    const paths = ["/sessions.list", "/api/sessions.list", "/sessions.list/", "//sessions.list"];

    const statuses = await Promise.all(
      paths.map(
        async (path) =>
          (
            await handler(
              new Request(`http://host.test${path}`, {
                method: "POST",
                headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
                body: "{}",
              }),
            )
          ).status,
      ),
    );

    expect(statuses).toEqual([200, 404, 404, 404]);
  });

  it("denies a participant an owner row and answers each failure at its status", async () => {
    const { handler, workspace } = await served({ maxBodyBytes: 64 });
    const denied = await post(
      handler,
      "git.stage",
      { workspace, paths: ["a.ts"] },
      {
        Authorization: "Bearer guest",
      },
    );

    expect(denied.status).toBe(403);
    expect(await errorOf(denied)).toMatchObject({ code: "denied" });

    const unknown = await post(handler, "session.teleport", {});
    const unwatched = await post(handler, "head.watch", { session: "nope", head: "main" });
    const read = await handler(new Request("http://host.test/sessions.list", { method: "GET" }));
    const strict = await post(handler, "session.info", { session: "s1", extra: true });
    const large = await post(handler, "settings.apply", { id: "x", value: "y".repeat(100) });
    const anonymous = await post(handler, "sessions.list", {}, { Authorization: "" });

    expect([unknown.status, read.status, strict.status, large.status, anonymous.status]).toEqual([
      404, 404, 400, 413, 401,
    ]);
    expect(await errorOf(unknown)).toMatchObject({ code: "unknown" });
    expect(unwatched.status).toBe(404);
    expect((await errorOf(strict)).issues.map((issue) => issue.path)).toEqual([["extra"]]);
    expect(await errorOf(large)).toMatchObject({ code: "invalid" });
  });

  it("exposes X-Nyte-Host to an allowed origin", async () => {
    const { handler } = await served();
    const listed = await post(handler, "sessions.list", {}, { Origin: "https://app.nyte.dev" });

    expect(HOST_HEADER).toBe("X-Nyte-Host");
    expect(listed.headers.get("Access-Control-Expose-Headers")).toContain(HOST_HEADER);
  });

  it("answers CORS for the allowed origins and denies the rest", async () => {
    const { handler } = await served();
    const preflight = (origin: string) =>
      handler(
        new Request("http://host.test/sessions.list", {
          method: "OPTIONS",
          headers: { Origin: origin },
        }),
      );
    const allowed = await preflight("https://app.nyte.dev");
    const refused = await preflight("https://evil.example");
    const listed = await post(handler, "sessions.list", {}, { Origin: "https://app.nyte.dev" });
    const foreign = await post(handler, "sessions.list", {}, { Origin: "https://evil.example" });
    const same = await post(handler, "sessions.list", {}, { Origin: "http://host.test" });

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://app.nyte.dev");
    expect(allowed.headers.get("Access-Control-Allow-Headers")).toContain("X-Nyte-Input");
    expect(refused.status).toBe(403);
    expect(listed.headers.get("Access-Control-Allow-Origin")).toBe("https://app.nyte.dev");
    expect(listed.headers.get("Access-Control-Expose-Headers")).toContain("X-Nyte-Version");
    expect(listed.headers.get("Access-Control-Expose-Headers")).toContain("X-Nyte-Mime");
    expect(foreign.status).toBe(403);
    expect(same.status).toBe(200);
    expect(same.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("writes bytes with the input in X-Nyte-Input and reads them back as an octet stream", async () => {
    const { handler, workspace } = await served();
    const request = new Request(
      "http://host.test/files.write",
      withInputHeader({ workspace, path: "notes.txt" }, new TextEncoder().encode("hello")),
    );
    request.headers.set("Authorization", "Bearer owner");
    const written = await handler(request);

    expect(decodeOutput("files.write", await written.json())).toMatchObject({ kind: "saved" });

    const read = await post(handler, "files.bytes", { workspace, path: "notes.txt" });

    expect(read.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(read.headers.get("X-Nyte-Mime")).toBe("text/plain");
    expect(read.headers.get("Content-Length")).toBe("5");
    expect(read.headers.get("X-Nyte-Version")).toBe("v1");
    expect(await read.text()).toBe("hello");

    const scan = await post(handler, "files.scan", { workspace });
    const frames = await until(scan, (frame) => kindOf(frame) === "complete");

    expect(frames.map((frame) => frame.id)).toEqual([null, null]);
    expect(frames[0]?.data).toMatchObject({ kind: "entries", entries: [{ path: "notes.txt" }] });
  });

  it("frames a job's output end to end through the environment's exec", async () => {
    const { handler, workspace } = await served();
    const started = decodeOutput(
      "jobs.start",
      await (await post(handler, "jobs.start", { workspace, command: "echo hi" })).json(),
    );
    const output = await post(handler, "job.output", { workspace, job: started.id });

    expect(output.headers.get("Content-Type")).toBe("application/octet-stream");
    assert(output.body !== null);
    const frames = [];

    for await (const frame of parseOutputFrames(output.body)) frames.push(frame);
    const text = frames
      .map((frame) => (frame.kind === "bytes" ? new TextDecoder().decode(frame.data) : ""))
      .join("");

    expect(text).toBe("hi\n");
    expect(frames.at(-1)).toEqual({ kind: "exit", code: 0 });
  });

  it("serves the host view with its authority as an array and its principal, and an act without output as null", async () => {
    const { handler, host } = await served();
    host.kernel.partDefinitions.register(question, null);
    const view = await until(await post(handler, "connection.watch", {}), () => true);

    expect(view[0]?.data).toMatchObject({
      id: host.hostId,
      authority: ["participant", "owner", "maintenance"],
    });
    expect(view[0]?.data).toHaveProperty("principal");

    const { session } = decodeOutput(
      "sessions.create",
      await (await post(handler, "sessions.create", {})).json(),
    );
    const created = decodeOutput(
      "parts.create",
      await (
        await post(handler, "parts.create", {
          session,
          kind: "test/question",
          input: { state: { title: "Pick" }, placement: { kind: "modal" } },
        })
      ).json(),
    );
    const acted = await post(handler, "part.act", {
      session,
      part: created.part,
      action: "answer",
      input: { choice: "a" },
    });

    expect(await acted.json()).toEqual({ kind: "ok", output: null });

    const missing = await post(handler, "parts.create", {
      session,
      kind: "test/nothing",
      input: { state: null, placement: { kind: "modal" } },
    });

    expect(await errorOf(missing)).toMatchObject({ code: "unknown" });
  });

  it("resolves a plugin's part kind for parts.create on a host that has not loaded the session yet (§48h)", async () => {
    const store = memoryStore();
    const plugins = [{ id: "asker", contribute: { parts: [question] } }];
    const warm = await served({ store, plugins });
    const { session } = decodeOutput(
      "sessions.create",
      await (await post(warm.handler, "sessions.create", {})).json(),
    );
    const cold = await served({ store, plugins });

    const created = await post(cold.handler, "parts.create", {
      session,
      kind: "test/question",
      input: { state: { title: "Pick" }, placement: { kind: "modal" } },
    });

    expect(created.status).toBe(200);
    await cold.host.close();
    await warm.host.close();
  });

  it("answers invalid when files.batch or browser.open replays its id with another input (§40x)", async () => {
    const { handler, pages, disk, workspace } = await served();

    const batch = {
      workspace,
      id: "batch-1",
      entries: [{ kind: "put", path: "a.txt", contents: "A" }],
    };

    const open = { workspace, url: "https://a.test", id: "open-1" };

    expect((await post(handler, "files.batch", batch)).status).toBe(200);
    expect((await post(handler, "browser.open", open)).status).toBe(200);

    const batched = await post(handler, "files.batch", {
      ...batch,
      entries: [{ kind: "put", path: "b.txt", contents: "B" }],
    });

    const opened = await post(handler, "browser.open", { ...open, url: "https://b.test" });

    expect([batched.status, opened.status]).toEqual([400, 400]);
    expect(await errorOf(batched)).toMatchObject({ code: "invalid" });
    expect(await errorOf(opened)).toMatchObject({ code: "invalid" });
    expect(pages.opened).toHaveLength(1);
    expect(disk.has("/work/b.txt")).toBe(false);
  });

  it("replays head.move, files.batch and browser.open by their wire ids (§40e)", async () => {
    const { handler, fake, disk, pages, workspace } = await served();
    fake.reply("One.");
    const { session, receipt } = await sent(handler);
    await post(handler, "receipt.settled", { session, receipt });
    const move = { session, head: main, position: { kind: "start" }, id: "move-1" };
    const moved = await post(handler, "head.move", move);
    const again = await post(handler, "head.move", move);
    const reused = await post(handler, "head.move", { ...move, options: { running: "stop" } });

    expect(await moved.json()).toEqual({ receipt: "move-1" });
    expect(await again.json()).toEqual({ receipt: "move-1" });
    expect(reused.status).toBe(400);

    const batch = {
      workspace,
      id: "batch-1",
      entries: [{ kind: "put", path: "b.txt", contents: "x" }],
    };

    expect(await (await post(handler, "files.batch", batch)).json()).toEqual({
      receipt: "batch-1",
    });
    expect(
      await (await post(handler, "receipt.settled", { session: null, receipt: "batch-1" })).json(),
    ).toMatchObject({ kind: "applied", paths: ["b.txt"] });
    expect(await (await post(handler, "files.batch", batch)).json()).toEqual({
      receipt: "batch-1",
    });
    expect(disk.get("/work/b.txt")?.version).toBe("v1");
    expect(
      await (await post(handler, "receipt.status", { session: null, receipt: "nope" })).json(),
    ).toEqual({ kind: "missing" });

    const open = { workspace, url: "https://a.b", id: "open-1" };
    const first = decodeOutput(
      "browser.open",
      await (await post(handler, "browser.open", open)).json(),
    );
    const second = decodeOutput(
      "browser.open",
      await (await post(handler, "browser.open", open)).json(),
    );

    expect(second).toEqual(first);
    expect(first).toMatchObject({ url: "https://a.b", holders: 1 });
    expect(pages.opened).toEqual([first.id]);
    expect(
      await (await post(handler, "page.click", { workspace, page: first.id, ref: "e1" })).json(),
    ).toMatchObject({ kind: "applied" });

    const capture = await post(handler, "page.capture", { workspace, page: first.id });

    expect(capture.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(capture.headers.get("X-Nyte-Mime")).toBe("image/png");
    expect([...new Uint8Array(await capture.arrayBuffer())]).toEqual([137, 80, 78]);
    expect(
      await (await post(handler, "page.close", { workspace, page: first.id })).json(),
    ).toBeNull();
    expect(pages.closed).toEqual([first.id]);
  });
});
