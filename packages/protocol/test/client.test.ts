import { SdkError } from "@nyte-ai/core";
import { assert, describe, expect, it } from "vitest";
import { HOST_HEADER, createTransport, decodeOutput, outputFrames } from "../src/index.ts";
import type { SseFrame } from "../src/index.ts";
import { served } from "./fakes.ts";

async function failure(run: () => Promise<unknown>): Promise<SdkError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SdkError) return error;
  }

  throw new Error("Expected an SdkError.");
}

async function take<T>(
  source: AsyncIterable<T>,
  done: (value: T) => boolean,
): Promise<readonly T[]> {
  const values: T[] = [];

  for await (const value of source) {
    values.push(value);

    if (done(value)) break;
  }

  return values;
}

function kindOf(frame: SseFrame): unknown {
  return typeof frame.data === "object" && frame.data !== null && "kind" in frame.data
    ? frame.data.kind
    : null;
}

describe("transport", () => {
  it("invokes a row, watches it, resumes after an id, and rethrows errors as SdkError", async () => {
    const { transport, fake } = await served();
    const owner = transport("Bearer owner");
    fake.reply("Hello.");
    const { session } = decodeOutput("sessions.create", await owner.invoke("sessions.create", {}));
    const { receipt } = decodeOutput(
      "head.send",
      await owner.invoke("head.send", { session, head: "main", content: "Hi." }),
    );

    expect(
      decodeOutput("receipt.settled", await owner.invoke("receipt.settled", { session, receipt })),
    ).toMatchObject({
      kind: "completed",
    });

    const first = await take(
      owner.watch("head.watch", { session, head: "main" }),
      (frame) => kindOf(frame) === "catalog",
    );
    const ids = first.flatMap((frame) => (frame.id === null ? [] : [frame.id]));
    const last = ids.at(-1);

    assert(last !== undefined);
    const resumed = await take(
      owner.watch("head.watch", { session, head: "main" }, last),
      (frame) => kindOf(frame) === "catalog",
    );

    expect(resumed.every((frame) => frame.id === null || Number(frame.id) > Number(last))).toBe(
      true,
    );
    expect(resumed.map(kindOf).slice(-2)).toEqual(["activation", "catalog"]);

    const denied = await failure(() => transport("Bearer guest").invoke("principals.list", {}));
    const unknown = await failure(() => owner.invoke("session.info", { session: "nope" }));
    const anonymous = await failure(() => transport("").invoke("sessions.list", {}));

    expect(denied).toBeInstanceOf(SdkError);
    expect([denied.code, unknown.code, anonymous.code]).toEqual([
      "denied",
      "unknown",
      "unauthenticated",
    ]);
  });

  it("aborts a watch's request at once when it returns, even while a pull waits (§40x)", async () => {
    const { transport, host } = await served();
    const owner = transport("Bearer owner");
    const { session } = decodeOutput("sessions.create", await owner.invoke("sessions.create", {}));
    const { bus } = host.kernel;
    const subscribe = bus.subscribe.bind(bus);
    let subscribed = 0;

    bus.subscribe = (id, listener) => {
      const dispose = subscribe(id, listener);
      let disposed = false;
      subscribed += 1;

      return () => {
        if (!disposed) subscribed -= 1;
        disposed = true;
        dispose();
      };
    };

    const watch = owner.watch("head.watch", { session, head: "main" })[Symbol.asyncIterator]();

    for (;;) {
      const next = await watch.next();

      if (next.done === true || kindOf(next.value) === "catalog") break;
    }

    assert(watch.return !== undefined);
    expect(subscribed).toBe(1);

    const pending = watch.next();

    const returned = await Promise.race([
      watch.return().then(() => "returned"),
      new Promise((resolve) => setTimeout(resolve, 0, "waiting")),
    ]);

    expect(returned).toBe("returned");
    expect(await pending).toEqual({ done: true, value: undefined });
    await expect.poll(() => subscribed).toBe(0);
  });

  it("uploads bytes, reads them back with their version, and streams frames", async () => {
    const { transport, workspace } = await served();
    const owner = transport("Bearer owner");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hel"));
        controller.enqueue(new TextEncoder().encode("lo"));
        controller.close();
      },
    });

    expect(
      decodeOutput(
        "files.write",
        await owner.upload("files.write", { workspace, path: "a.txt" }, body),
      ),
    ).toMatchObject({ kind: "saved" });

    const reader = await owner.bytes("files.bytes", { workspace, path: "a.txt" });
    const chunks: Uint8Array[] = [];

    for await (const chunk of reader.chunks()) chunks.push(chunk);
    await reader.close();

    expect(reader).toMatchObject({ size: 5, mime: "text/plain", version: "v1" });
    expect(new TextDecoder().decode(new Uint8Array(chunks.flatMap((chunk) => [...chunk])))).toBe(
      "hello",
    );

    const scanned = await take(owner.frames("files.scan", { workspace }), () => false);

    expect(scanned).toEqual([
      { kind: "entries", entries: [{ path: "a.txt", kind: "file", size: 5, version: "v1" }] },
      { kind: "complete" },
    ]);

    const started = decodeOutput(
      "jobs.start",
      await owner.invoke("jobs.start", { workspace, command: "echo hi" }),
    );

    const output = await take(owner.output({ workspace, job: started.id }), () => false);

    expect(output.at(-1)).toEqual({ kind: "exit", code: 0 });
    expect(
      output.flatMap((frame) =>
        frame.kind === "bytes" ? [new TextDecoder().decode(frame.data)] : [],
      ),
    ).toEqual(["hi\n"]);
  });

  it("runs a login over steps and answers, holding the attempt per principal and provider", async () => {
    const { transport } = await served();
    const owner = transport("Bearer owner");

    expect(
      await owner.invoke("models.login", { provider: "test", method: { kind: "key" } }),
    ).toBeNull();
    const steps = owner.frames("login.steps", { provider: "test" })[Symbol.asyncIterator]();
    const paste = await steps.next();

    expect(paste.value).toEqual({ kind: "paste", message: "Paste your key.", secret: true });
    expect(await owner.invoke("login.answer", { provider: "test", code: "sk-1" })).toBeNull();

    const rest: unknown[] = [];

    for (;;) {
      const next = await steps.next();

      if (next.done === true) break;
      rest.push(next.value);
    }

    expect(rest.at(-1)).toEqual({ kind: "done" });
    expect(
      await failure(() => owner.invoke("login.answer", { provider: "test", code: "x" })),
    ).toMatchObject({
      code: "unknown",
    });
  });

  it("keeps the credential a pairing exchange returns", async () => {
    const { transport } = await served();
    const pairing = transport("Pairing 123-456");

    expect(pairing.credential()).toBeNull();
    await pairing.invoke("sessions.list", {});
    expect(pairing.credential()).toBe("device-token");
  });

  it("reads job output as framed octets whatever Content-Type the answer carries (ADV G8)", async () => {
    const frames = async function* () {
      yield { kind: "bytes", data: new TextEncoder().encode("hi") } as const;
      yield { kind: "exit", code: 0 } as const;
    };

    const transport = createTransport({
      url: "http://host.test",
      headers: async () => ({}),
      fetch: async () =>
        new Response(outputFrames(frames()), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
    });

    expect(await take(transport.output({}), () => false)).toEqual([
      { kind: "bytes", data: new TextEncoder().encode("hi") },
      { kind: "exit", code: 0 },
    ]);
  });

  it("pins the first X-Nyte-Host, error answers included, and throws stale naming another host, its answer unread (ADV C N5, probe N4)", async () => {
    let answer = { status: 404, host: "host-a" };

    const transport = createTransport({
      url: "http://host.test",
      headers: async () => ({}),
      fetch: async () =>
        new Response(
          answer.status === 200
            ? "{}"
            : JSON.stringify({ code: "unknown", message: "No session has that id." }),
          {
            status: answer.status,
            headers: { "Content-Type": "application/json", [HOST_HEADER]: answer.host },
          },
        ),
    });

    expect(transport.host()).toBeNull();
    await expect(transport.invoke("sessions.list", {})).rejects.toMatchObject({ code: "unknown" });
    expect(transport.host()).toBe("host-a");
    answer = { status: 200, host: "host-a" };
    await transport.invoke("sessions.list", {});
    answer = { status: 404, host: "host-b" };

    expect(await failure(() => transport.invoke("sessions.list", {}))).toMatchObject({
      code: "stale",
      hostId: "host-b",
    });
    expect(transport.host()).toBe("host-a");
  });

  it("answers only a fetch TypeError as unavailable; any other exception reaches the caller as thrown (ADV G10, probe N2)", async () => {
    const denied = new SdkError("denied", "Policy refused this request.");
    const programming = new RangeError("A bug in the custom fetch.");
    let thrown: unknown = denied;

    const transport = createTransport({
      url: "http://host.test",
      headers: async () => ({}),
      fetch: async () => {
        throw thrown;
      },
    });

    await expect(transport.invoke("models.list", {})).rejects.toBe(denied);
    thrown = programming;
    await expect(transport.invoke("models.list", {})).rejects.toBe(programming);
    thrown = new TypeError("fetch failed");
    await expect(transport.invoke("models.list", {})).rejects.toMatchObject({
      code: "unavailable",
      message: "fetch failed",
    });
  });

  it("answers a network failure as unavailable", async () => {
    const transport = createTransport({
      url: "http://nowhere.test",
      headers: async () => ({}),
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    expect(await failure(() => transport.invoke("sessions.list", {}))).toMatchObject({
      code: "unavailable",
      message: "fetch failed",
    });
  });
});
