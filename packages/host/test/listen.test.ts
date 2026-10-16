import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asId } from "@nyte-ai/schema";
import type {
  Authority,
  ExecutionCoverage,
  HeadName,
  Json,
  Owned,
  PrincipalId,
  ReceiptId,
  SessionId,
} from "@nyte-ai/schema";
import type { ComposeOptions, Listener, ListenOptions } from "@nyte-ai/core";
import { SdkError, memoryStore } from "@nyte-ai/core";
import { createTransport, decodeError, parseSse } from "@nyte-ai/protocol";
import { afterEach, assert, describe, expect, it } from "vitest";
import { listen, pluginLoader } from "../src/index.ts";
import { fakeModels, open } from "../src/bench/fake-models.ts";
import type { FakeModels } from "../src/bench/fake-models.ts";

const TOKEN = "a-token-of-at-least-16";

const main: HeadName = asId("main");

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Composed = Awaited<ReturnType<typeof open>>;

async function compose(
  fake: FakeModels,
  execution?: ComposeOptions["execution"],
): Promise<Composed> {
  const host = await open(fake, { execution });
  cleanups.push(() => host.close());

  return host;
}

async function serve(host: Composed, options?: Partial<ListenOptions>): Promise<Listener> {
  const listener = await listen(host, {
    transport: { kind: "fetch" },
    auth: { kind: "token", token: TOKEN },
    ...options,
  });

  cleanups.push(() => listener.close());

  return listener;
}

function post(
  target: Listener | string,
  name: string,
  input: unknown,
  headers?: Readonly<Record<string, string>>,
  signal?: AbortSignal,
): Promise<Response> {
  const init: RequestInit = {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...headers },
    body: JSON.stringify(input),
    signal,
  };

  return typeof target === "string"
    ? fetch(`${target}/${name}`, init)
    : target.fetch(new Request(`http://host.test/${name}`, init));
}

async function json(response: Response): Promise<unknown> {
  return response.json();
}

async function codeOf(response: Response): Promise<string> {
  return decodeError(JSON.parse(await response.text()), response.status).code;
}

function kindOf(frame: Json): string | null {
  return typeof frame === "object" &&
    frame !== null &&
    "kind" in frame &&
    typeof frame.kind === "string"
    ? frame.kind
    : null;
}

async function until(response: Response, done: (frame: Json) => boolean): Promise<readonly Json[]> {
  const frames: Json[] = [];
  assert(response.body !== null);

  for await (const frame of parseSse(response.body)) {
    frames.push(frame);

    if (done(frame)) break;
  }

  return frames;
}

async function sent(
  target: Listener | string,
): Promise<{ readonly session: SessionId; readonly receipt: ReceiptId }> {
  const created = await json(await post(target, "sessions.create", {}));
  assert(
    typeof created === "object" &&
      created !== null &&
      "session" in created &&
      typeof created.session === "string",
  );
  const session: SessionId = asId(created.session);

  const receipt = await json(
    await post(target, "head.send", { session, head: main, content: "Hi." }),
  );

  assert(
    typeof receipt === "object" &&
      receipt !== null &&
      "receipt" in receipt &&
      typeof receipt.receipt === "string",
  );

  return { session, receipt: asId(receipt.receipt) };
}

async function pair(host: Composed, authority: readonly Authority[]): Promise<string> {
  return (await host.principals.pair({ authority: new Set(authority) })).code;
}

function within<T>(promise: Promise<T>, ms: number): Promise<T | "timed out"> {
  return Promise.race([
    promise,
    new Promise<"timed out">((resolve) => setTimeout(() => resolve("timed out"), ms)),
  ]);
}

async function endOf(frames: AsyncIterator<Json>): Promise<string> {
  try {
    while ((await frames.next()).done !== true);

    return "ended";
  } catch (error) {
    return error instanceof SdkError ? error.code : String(error);
  }
}

describe("listen", () => {
  it("refuses a token shorter than 16 characters before anything binds", async () => {
    const host = await compose(fakeModels());

    await expect(
      listen(host, { transport: { kind: "http" }, auth: { kind: "token", token: "short" } }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("accepts exactly the token, compared by digest, and nothing else", async () => {
    const listener = await serve(await compose(fakeModels()));

    expect(listener.address).toBeNull();
    expect((await post(listener, "sessions.list", {})).status).toBe(200);

    for (const authorization of [
      `Bearer ${TOKEN.slice(0, -1)}x`,
      `Bearer ${TOKEN.slice(0, -1)}`,
      `Bearer ${TOKEN}0`,
      "Basic abc",
      "",
    ]) {
      const response = await post(listener, "sessions.list", {}, { Authorization: authorization });

      expect([response.status, await codeOf(response)]).toEqual([401, "unauthenticated"]);
    }
  });

  it("exchanges a pairing code once for a device token in X-Nyte-Credential, which reconnects until revoked", async () => {
    const host = await compose(fakeModels());
    const listener = await serve(host);
    const code = await pair(host, ["participant", "owner"]);

    const transport = createTransport({
      url: "http://host.test",
      headers: async () => ({ Authorization: `Pairing ${code}` }),
      fetch: async (input, init) => listener.fetch(new Request(input, init)),
    });

    await transport.invoke("sessions.list", {});
    const credential = transport.credential();
    assert(credential !== null);
    expect(credential).toMatch(/^[0-9a-f]{64}$/);
    await expect(transport.invoke("sessions.list", {})).rejects.toMatchObject({
      code: "unauthenticated",
    });

    const device = { Authorization: `Bearer ${credential}` };
    expect((await post(listener, "sessions.list", {}, device)).status).toBe(200);
    const [paired] = await host.principals.list();
    assert(paired !== undefined);
    expect([...paired.authority].sort()).toEqual(["owner", "participant"]);

    await host.principals.revoke(paired.id);
    const revoked = await post(listener, "sessions.list", {}, device);
    expect([revoked.status, await codeOf(revoked)]).toEqual([401, "unauthenticated"]);
  });

  it("ends a revoked principal's open head.watch at once, unauthenticated, while another principal's keeps flowing", async () => {
    const host = await compose(fakeModels());
    const listener = await serve(host);
    const created = await json(await post(listener, "sessions.create", {}));
    assert(
      typeof created === "object" &&
        created !== null &&
        "session" in created &&
        typeof created.session === "string",
    );
    const session = created.session;

    const watching = async (label: string) => {
      const { code } = await host.principals.pair({
        authority: new Set<Authority>(["participant"]),
        label,
      });

      const exchange = await post(
        listener,
        "sessions.list",
        {},
        { Authorization: `Pairing ${code}` },
      );

      const token = exchange.headers.get("X-Nyte-Credential");
      assert(token !== null);

      const transport = createTransport({
        url: "http://host.test",
        headers: async () => ({ Authorization: `Bearer ${token}` }),
        fetch: async (input, init) => listener.fetch(new Request(input, init)),
      });
      const frames = transport
        .frames("head.watch", { session, head: main })
        [Symbol.asyncIterator]();
      expect(kindOf((await frames.next()).value ?? null)).toBe("view");

      return frames;
    };

    const revoked = await watching("revoked");
    const kept = await watching("kept");
    const id = (await host.principals.list()).find((row) => row.label === "revoked")?.id;
    assert(id !== undefined);
    await host.principals.revoke(id);

    expect(await within(endOf(revoked), 100)).toBe("unauthenticated");
    await post(listener, "head.send", { session, head: main, content: "Still here." });

    const delivered = within(
      (async () => {
        for (let next = await kept.next(); next.done !== true; next = await kept.next())
          if (JSON.stringify(next.value).includes("Still here.")) return kindOf(next.value);

        return "ended";
      })(),
      1_000,
    );

    expect(await delivered).toBe("delta");
    await kept.return?.(undefined);
  });

  it("re-reads a remembered device token when another host commits, so its revoke there ends an open head.watch here (ADV C 3)", async () => {
    const store = memoryStore();
    const host = await open(fakeModels(), { store, poll: 10 });
    cleanups.push(() => host.close());
    const other = await open(fakeModels(), { store });
    cleanups.push(() => other.close());
    const listener = await serve(host);

    const exchange = await post(
      listener,
      "sessions.list",
      {},
      { Authorization: `Pairing ${await pair(other, ["participant"])}` },
    );

    const token = exchange.headers.get("X-Nyte-Credential");
    assert(token !== null);
    const device = { Authorization: `Bearer ${token}` };

    expect((await post(listener, "sessions.list", {}, device)).status).toBe(200);
    const created = await host.sessions.create();
    const watch = await post(listener, "head.watch", { session: created.id, head: main }, device);

    assert(watch.body !== null);
    const frames = parseSse(watch.body)[Symbol.asyncIterator]();
    expect(kindOf((await frames.next()).value ?? null)).toBe("view");

    const ended = endOf(frames);
    const [paired] = await other.principals.list();
    assert(paired !== undefined);
    await other.principals.revoke(paired.id);

    expect(await within(ended, 1_000)).toBe("unauthenticated");
    const revoked = await post(listener, "sessions.list", {}, device);
    expect([revoked.status, await codeOf(revoked)]).toEqual([401, "unauthenticated"]);
  });

  it("ends a head.watch opened by its own pairing request once another host's revoke commits (ADV C-3 N2, probe N2r)", async () => {
    const store = memoryStore();
    const host = await open(fakeModels(), { store, poll: 10 });
    cleanups.push(() => host.close());
    const other = await open(fakeModels(), { store });
    cleanups.push(() => other.close());
    const listener = await serve(host);
    const session = await host.sessions.create();

    const watch = await post(
      listener,
      "head.watch",
      { session: session.id, head: main },
      { Authorization: `Pairing ${await pair(other, ["participant"])}` },
    );

    expect(watch.headers.get("X-Nyte-Credential")).not.toBeNull();
    assert(watch.body !== null);
    const frames = parseSse(watch.body)[Symbol.asyncIterator]();
    expect(kindOf((await frames.next()).value ?? null)).toBe("view");

    const ended = endOf(frames);
    const [paired] = await other.principals.list();
    assert(paired !== undefined);
    await other.principals.revoke(paired.id);

    expect(await within(ended, 1_000)).toBe("unauthenticated");
  });

  it("denies a participant git.stage by the row's authority", async () => {
    const host = await compose(fakeModels());
    const listener = await serve(host);

    const exchange = await post(
      listener,
      "sessions.list",
      {},
      { Authorization: `Pairing ${await pair(host, ["participant"])}` },
    );

    const token = exchange.headers.get("X-Nyte-Credential");
    assert(token !== null);

    const response = await post(
      listener,
      "git.stage",
      { workspace: "w", paths: ["a.txt"] },
      { Authorization: `Bearer ${token}` },
    );

    expect([response.status, await codeOf(response)]).toEqual([403, "denied"]);
  });

  it("maps custom authorization to a principal, 401 and 403, and loads wire plugin paths through the kernel's loader", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "nyte-listen-")));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const host = await open(fakeModels(), {
      loadPlugins: pluginLoader([dir]),
    });
    cleanups.push(() => host.close());
    await writeFile(join(dir, "extra.mjs"), 'export default { id: "extra" };\n');
    const maintainer: PrincipalId = asId("maintainer");

    const listener = await serve(host, {
      auth: {
        kind: "custom",
        authorize: (request) => {
          const who = request.headers.get("X-Who");

          return who === "admin"
            ? {
                principal: maintainer,
                authority: new Set<Authority>(["participant", "owner", "maintenance"]),
              }
            : { deny: who === null ? "unauthorized" : "forbidden" };
        },
      },
    });

    const checked = await post(
      listener,
      "plugins.check",
      { plugins: [{ path: join(dir, "extra.mjs") }] },
      { "X-Who": "admin" },
    );

    expect(checked.status).toBe(200);
    expect(await json(checked)).toMatchObject({ plugins: [{ id: "extra", kind: "activated" }] });
    expect((await post(listener, "sessions.list", {}, { Authorization: "" })).status).toBe(401);
    expect((await post(listener, "sessions.list", {}, { "X-Who": "guest" })).status).toBe(403);
  });

  it("answers a paired device's bearer token under custom auth before authorize, which still refuses the rest (§41j)", async () => {
    const host = await compose(fakeModels());
    const asked: (string | null)[] = [];

    const listener = await serve(host, {
      auth: {
        kind: "custom",
        authorize: (request) => {
          asked.push(request.headers.get("Authorization"));

          return { deny: "unauthorized" };
        },
      },
    });

    const exchange = await post(
      listener,
      "sessions.list",
      {},
      { Authorization: `Pairing ${await pair(host, ["participant"])}` },
    );

    const token = exchange.headers.get("X-Nyte-Credential");
    assert(token !== null);
    const random = `Bearer ${"f".repeat(64)}`;

    expect(exchange.status).toBe(200);
    expect(
      (await post(listener, "sessions.list", {}, { Authorization: `Bearer ${token}` })).status,
    ).toBe(200);
    const refused = await post(listener, "sessions.list", {}, { Authorization: random });

    expect([refused.status, await codeOf(refused)]).toEqual([401, "unauthenticated"]);
    expect(asked).toEqual([random]);
  });

  it("answers before first, then the identity and describe routes", async () => {
    const host = await compose(fakeModels());
    const signed: string[] = [];

    const listener = await serve(host, {
      origins: ["https://app.nyte.dev"],
      identity: {
        id: host.hostId,
        sign: async (nonce) => {
          signed.push(nonce);

          return {
            hostId: asId("elsewhere"),
            nonce,
            signature: `signed:${nonce}`,
            publicKey: "key",
          };
        },
      },
      describe: () => ({ name: "desk", platform: "darwin", version: "1.2.3" }),
      before: (request) =>
        new URL(request.url).pathname === "/health" ? new Response("ok") : undefined,
    });

    expect(await (await listener.fetch(new Request("http://host.test/health"))).text()).toBe("ok");

    const identity = await listener.fetch(
      new Request("http://host.test/.nyte/identity?nonce=n1", {
        headers: { Origin: "https://app.nyte.dev" },
      }),
    );

    expect(await identity.json()).toEqual({
      hostId: host.hostId,
      nonce: "n1",
      signature: "signed:n1",
      publicKey: "key",
    });
    expect(identity.headers.get("Access-Control-Allow-Origin")).toBe("https://app.nyte.dev");
    expect(identity.headers.get("X-Nyte-Host")).toBe(host.hostId);
    expect(identity.headers.get("Access-Control-Expose-Headers")).toContain("X-Nyte-Host");
    expect(signed).toEqual(["n1"]);
    expect((await listener.fetch(new Request("http://host.test/.nyte/identity"))).status).toBe(404);
    expect(
      await (await listener.fetch(new Request("http://host.test/.nyte/describe"))).json(),
    ).toEqual({
      name: "desk",
      platform: "darwin",
      version: "1.2.3",
    });

    const bare = await serve(host);
    expect((await bare.fetch(new Request("http://host.test/.nyte/identity?nonce=n"))).status).toBe(
      404,
    );
    expect((await bare.fetch(new Request("http://host.test/.nyte/describe"))).status).toBe(404);
  });

  it("answers CORS preflights for allowed origins and denies others", async () => {
    const listener = await serve(await compose(fakeModels()), {
      origins: ["https://app.nyte.dev"],
    });

    const preflight = await listener.fetch(
      new Request("http://host.test/sessions.list", {
        method: "OPTIONS",
        headers: { Origin: "https://app.nyte.dev", "Access-Control-Request-Method": "POST" },
      }),
    );

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Origin")).toBe("https://app.nyte.dev");

    const allowed = await post(listener, "sessions.list", {}, { Origin: "https://app.nyte.dev" });
    expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe("https://app.nyte.dev");
    expect(allowed.headers.get("Access-Control-Expose-Headers")).toContain("X-Nyte-Credential");

    const other = await post(listener, "sessions.list", {}, { Origin: "https://evil.example" });
    expect([other.status, await codeOf(other)]).toEqual([403, "denied"]);
  });

  it("limits the body to maxBodyBytes", async () => {
    const listener = await serve(await compose(fakeModels()), { maxBodyBytes: 64 });
    const response = await post(listener, "sessions.create", { title: "x".repeat(200) });

    expect([response.status, await codeOf(response)]).toEqual([413, "invalid"]);
  });

  it("serves a head.watch over node:http, the head's whole view first", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Hello there." }] });
    const listener = await serve(await compose(fake), { transport: { kind: "http" } });
    const address = listener.address;
    assert(address !== null);
    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const { session, receipt } = await sent(address);
    const settled = await post(address, "receipt.settled", { session, receipt });
    expect(await json(settled)).toMatchObject({ kind: "completed" });

    const [first] = await until(
      await post(address, "head.watch", { session, head: main }),
      () => true,
    );

    expect(first).toMatchObject({
      kind: "view",
      view: { messages: [{ kind: "user", content: "Hi." }, { kind: "part" }] },
    });
  });

  it("streams events as they happen over node:http without buffering, and disconnects clients", async () => {
    const fake = fakeModels();
    let release = (): void => undefined;

    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    fake.reply({ content: [{ type: "text", text: "Held reply." }], until: hold });
    const listener = await serve(await compose(fake), { transport: { kind: "http" } });
    const address = listener.address;
    assert(address !== null);
    const { session } = await sent(address);
    const watch = await post(address, "head.watch", { session, head: main });

    expect(watch.headers.get("Content-Type")).toBe("text/event-stream");
    assert(watch.body !== null);
    const frames = parseSse(watch.body)[Symbol.asyncIterator]();
    let seen = (await frames.next()).value;

    while (seen !== undefined && !JSON.stringify(seen).includes('"kind":"live"'))
      seen = (await frames.next()).value;
    expect(seen).toBeDefined();

    listener.disconnectClients();
    let ended = false;

    try {
      while (!(await frames.next()).done);
      ended = true;
    } catch {
      ended = true;
    }

    expect(ended).toBe(true);
    expect((await post(address, "sessions.list", {})).status).toBe(200);
    release();
  });

  it("closes once: the socket refuses, fetch answers unavailable, coverage released", async () => {
    const host = await compose(fakeModels());
    const listener = await serve(host, { transport: { kind: "http" } });
    const address = listener.address;
    assert(address !== null);
    await listener.close();
    await listener.close();

    await expect(fetch(`${address}/sessions.list`, { method: "POST" })).rejects.toThrow();
    const after = await post(listener, "sessions.list", {});
    expect([after.status, await codeOf(after)]).toEqual([503, "unavailable"]);
  });
});

describe("listen's execution (§41b)", () => {
  function recording(host: Composed): {
    readonly host: Composed;
    readonly covered: ExecutionCoverage[];
  } {
    const covered: ExecutionCoverage[] = [];

    return {
      covered,
      host: {
        ...host,
        execution: {
          ...host.execution,
          cover: async (coverage): Promise<Owned> => {
            covered.push(coverage);

            return host.execution.cover(coverage);
          },
        },
      },
    };
  }

  it("drives sessions in process when the kernel only admits", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Driven." }] });
    const { host, covered } = recording(await compose(fake, { kind: "admit-only" }));
    const listener = await serve(host);
    const { session, receipt } = await sent(listener);

    expect(await json(await post(listener, "receipt.settled", { session, receipt }))).toMatchObject(
      {
        kind: "completed",
      },
    );
    expect(covered).toEqual([]);
  });

  it("only takes leases when the kernel already runs", async () => {
    const { host, covered } = recording(await compose(fakeModels()));
    await serve(host, { execution: { kind: "run", coverage: { kind: "all" } } });

    expect(covered).toEqual([{ kind: "all" }]);
  });

  it("takes nothing and drives nothing under admit-only", async () => {
    const fake = fakeModels();
    fake.reply({ content: [{ type: "text", text: "Never." }] });
    const { host, covered } = recording(await compose(fake, { kind: "admit-only" }));
    const listener = await serve(host, { execution: { kind: "admit-only" } });
    const { session, receipt } = await sent(listener);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(covered).toEqual([]);
    expect(fake.requests).toHaveLength(0);
    expect(await json(await post(listener, "receipt.status", { session, receipt }))).toMatchObject({
      kind: "pending",
    });
  });
});
