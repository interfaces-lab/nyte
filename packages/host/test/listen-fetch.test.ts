import type { ByteReader, ExecutionCoverage, Owned } from "@nyte-ai/schema";
import { memoryStore } from "@nyte-ai/core";
import type { Listener, Store } from "@nyte-ai/core";
import { decodeError, errorStatus } from "@nyte-ai/protocol";
import { afterEach, assert, describe, expect, it } from "vitest";
import { listenFetch } from "../src/listen-fetch.ts";
import { fakeModels, open } from "../src/bench/fake-models.ts";

const TOKEN = "a-token-of-at-least-16";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function post(listener: Listener, name: string, authorization: string): Promise<Response> {
  return listener.fetch(
    new Request(`http://host.test/${name}`, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: "{}",
    }),
  );
}

function endless(): ByteReader & { closes(): number } {
  let closes = 0;
  const closed = Promise.withResolvers<void>();

  return {
    size: null,
    mime: null,
    async *chunks() {
      yield Uint8Array.of(7);
      await closed.promise;
    },
    close: async () => {
      closes += 1;
      closed.resolve();
    },
    closes: () => closes,
    [Symbol.asyncDispose]: async () => undefined,
  };
}

describe("listenFetch", () => {
  it("serves the protocol with no socket, the token compared through Web Crypto", async () => {
    const host = await open(fakeModels());
    cleanups.push(() => host.close());

    const listener = await listenFetch(host, {
      transport: { kind: "fetch" },
      auth: { kind: "token", token: TOKEN },
    });

    cleanups.push(() => listener.close());

    expect(listener.address).toBeNull();
    expect((await post(listener, "sessions.list", `Bearer ${TOKEN}`)).status).toBe(200);

    for (const authorization of [`Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, ""]) {
      const refused = await post(listener, "sessions.list", authorization);

      expect(refused.status).toBe(401);
      expect(decodeError(JSON.parse(await refused.text()), refused.status).code).toBe(
        "unauthenticated",
      );
    }

    await expect(
      listenFetch(host, { transport: { kind: "fetch" }, auth: { kind: "token", token: "short" } }),
    ).rejects.toMatchObject({ code: "invalid" });
  });

  it("treats a dispatch kernel as admit-only: no in-process driver and no cover (§42v)", async () => {
    const dispatched: string[] = [];
    const covered: ExecutionCoverage[] = [];

    const host = await open(fakeModels(), {
      execution: {
        kind: "dispatch",
        dispatch: async ({ session }) => {
          dispatched.push(session);
        },
      },
    });

    cleanups.push(() => host.close());

    const listener = await listenFetch(
      {
        ...host,
        execution: {
          ...host.execution,
          cover: async (coverage): Promise<Owned> => {
            covered.push(coverage);

            return host.execution.cover(coverage);
          },
        },
      },
      { transport: { kind: "fetch" }, auth: { kind: "token", token: TOKEN } },
    );

    cleanups.push(() => listener.close());
    const session = await host.sessions.create();
    await session.send("Go.");

    expect(covered).toEqual([]);
    expect(dispatched).toEqual([session.id]);
  });

  it("fails job.output for a job this instance does not hold before any stream opens (§42aa)", async () => {
    const host = await open(fakeModels());
    cleanups.push(() => host.close());

    const listener = await listenFetch(host, {
      transport: { kind: "fetch" },
      auth: { kind: "token", token: TOKEN },
    });

    cleanups.push(() => listener.close());

    const response = await listener.fetch(
      new Request("http://host.test/job.output", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          workspace: (await host.workspaces.list())[0]?.id,
          job: "no-such-job",
        }),
      }),
    );

    expect(response.status).toBe(errorStatus.unavailable);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(decodeError(JSON.parse(await response.text()), response.status).code).toBe(
      "unavailable",
    );
  });

  it("ends a raw byte body and closes its provider reader when the listener closes (ADV G P5)", async () => {
    const reader = endless();
    const base = memoryStore();

    const store: Store = {
      ...base,
      open: async () => {
        const opened = await base.open();

        return { ...opened, objects: { ...opened.objects, blob: async () => reader } };
      },
    };

    const host = await open(fakeModels(), { store });
    cleanups.push(() => host.close());

    const listener = await listenFetch(host, {
      transport: { kind: "fetch" },
      auth: { kind: "token", token: TOKEN },
    });

    const response = await listener.fetch(
      new Request("http://host.test/connection.blob", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: "b1" }),
      }),
    );
    const body = response.body?.getReader();

    assert(body !== undefined);
    expect((await body.read()).value).toEqual(Uint8Array.of(7));
    await listener.close();

    await expect(body.read()).rejects.toThrow();
    expect(reader.closes()).toBe(1);
  });
});
