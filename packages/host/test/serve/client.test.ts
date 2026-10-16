import { SdkError } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import {
  CHANNEL_HEADER,
  CHANNEL_PATH,
  HOST_HEADER,
  STREAM_HEADER,
  createTransport,
  decodeOutput,
  outputFrames,
} from "@nyte-ai/protocol";
import { createStreamChannels } from "../../src/serve/stream-server.ts";
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

describe("transport", () => {
  it("invokes a row, watches it, and rethrows errors as SdkError", async () => {
    const { transport, fake } = await served();
    const owner = transport("Bearer owner");
    fake.reply("Hello.");
    const { session, receipt } = decodeOutput(
      "sessions.start",
      await owner.invoke("sessions.start", { content: "Hi." }),
    );

    expect(
      decodeOutput("receipt.settled", await owner.invoke("receipt.settled", { session, receipt })),
    ).toMatchObject({
      kind: "completed",
    });

    const [first] = await take(owner.frames("head.watch", { session, head: "main" }), () => true);
    const frame = decodeOutput("head.watch", first);

    assert(frame.kind === "view");
    expect(frame.view.messages.map((message) => message.kind)).toEqual(["user", "part"]);

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
    const { session } = decodeOutput(
      "sessions.start",
      await owner.invoke("sessions.start", { content: "Hi." }),
    );
    const { folds } = host.kernel;
    const acquire = folds.acquire.bind(folds);
    let held = 0;

    folds.acquire = (id, principal) => {
      const hold = acquire(id, principal);
      let released = false;
      held += 1;

      return {
        ...hold,
        release() {
          if (!released) held -= 1;
          released = true;
          hold.release();
        },
      };
    };

    const watch = owner.frames("head.watch", { session, head: "main" })[Symbol.asyncIterator]();
    await watch.next();

    assert(watch.return !== undefined);
    expect(held).toBe(1);

    const pending = watch.next();

    const returned = await Promise.race([
      watch.return().then(() => "returned"),
      new Promise((resolve) => setTimeout(resolve, 0, "waiting")),
    ]);

    expect(returned).toBe("returned");
    expect(await pending).toEqual({ done: true, value: undefined });
    await expect.poll(() => held).toBe(0);
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
      await owner.invoke("models.login", {
        provider: "test",
        method: { kind: "key" },
        label: "Work",
      }),
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

    const accounts = decodeOutput(
      "models.accounts",
      await owner.invoke("models.accounts", { provider: "test" }),
    );

    const [account] = accounts;
    assert(account !== undefined);

    expect(accounts).toEqual([
      {
        provider: "test",
        id: account.id,
        label: "Work",
        method: { kind: "key" },
        active: true,
      },
    ]);
    expect(
      await owner.invoke("models.selectAccount", { provider: "test", account: account.id }),
    ).toBeNull();
    expect(decodeOutput("models.usage", await owner.invoke("models.usage", {}))[0]).toMatchObject({
      provider: "test",
      account: { id: account.id, label: "Work" },
      state: { kind: "unavailable", reason: "unsupported" },
    });
    expect(
      await failure(() => owner.invoke("login.answer", { provider: "test", code: "x" })),
    ).toMatchObject({
      code: "unknown",
    });
  });

  it("cancels a waiting login over HTTP without saving it or blocking the next login", async () => {
    const { host, fake, transport } = await served();
    await using _cleanup = host;
    const provider = fake.models.getProvider("test");
    assert(provider !== undefined);
    const apiKey = provider.auth.apiKey;
    assert(apiKey !== undefined && apiKey.login !== undefined);
    const original = apiKey.login.bind(apiKey);
    let signal: AbortSignal | undefined;

    fake.models.setProvider({
      ...provider,
      auth: {
        ...provider.auth,
        apiKey: {
          ...apiKey,
          login(interaction) {
            signal = interaction.signal;

            return original(interaction);
          },
        },
      },
    });

    const owner = transport("Bearer owner");
    await owner.invoke("models.login", { provider: "test", method: { kind: "key" } });
    const steps = owner.frames("login.steps", { provider: "test" })[Symbol.asyncIterator]();

    expect((await steps.next()).value).toEqual({
      kind: "paste",
      message: "Paste your key.",
      secret: true,
    });

    const waiting = steps.next();
    await steps.return?.();

    expect(await waiting).toEqual({ done: true, value: undefined });
    expect(signal?.aborted).toBe(true);
    expect(await owner.invoke("models.accounts", {})).toEqual([]);
    await expect(
      owner.invoke("login.answer", { provider: "test", code: "late" }),
    ).rejects.toMatchObject({ code: "unknown" });

    await owner.invoke("models.login", { provider: "test", method: { kind: "key" } });

    for await (const frame of owner.frames("login.steps", { provider: "test" })) {
      const step = decodeOutput("login.steps", frame);

      if (step.kind === "paste")
        await owner.invoke("login.answer", { provider: "test", code: "sk-retry" });

      if (step.kind === "failed") throw new Error(step.reason);
    }

    expect(
      decodeOutput("models.accounts", await owner.invoke("models.accounts", {})).map(
        (account) => account.label,
      ),
    ).toEqual(["Account 1"]);
  });

  it("keeps the credential a pairing exchange returns", async () => {
    const { transport } = await served();
    const pairing = transport("Pairing 123-456");

    expect(pairing.credential()).toBeNull();
    await pairing.invoke("sessions.list", {});
    expect(pairing.credential()).toBe("device-token");
  });

  it("reads job output as framed octets whatever Content-Type the answer carries (ADV G8)", async () => {
    const { owner } = await served();
    const channels = createStreamChannels();

    const frames = async function* () {
      yield { kind: "bytes", data: new TextEncoder().encode("hi") } as const;
      yield { kind: "exit", code: 0 } as const;
    };

    const transport = createTransport({
      url: "http://host.test",
      headers: async () => ({}),
      fetch: async (input, init) => {
        const request = new Request(input, init);

        if (new URL(request.url).pathname === `/${CHANNEL_PATH}`)
          return channels.open(owner, request.signal);
        const channel = request.headers.get(CHANNEL_HEADER);
        const stream = request.headers.get(STREAM_HEADER);
        assert(channel !== null && stream !== null);

        return channels.start(
          owner,
          channel,
          stream,
          request.signal,
          async () =>
            new Response(outputFrames(frames()), {
              status: 200,
              headers: { "Content-Type": "text/event-stream" },
            }),
        );
      },
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
