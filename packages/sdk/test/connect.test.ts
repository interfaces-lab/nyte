import { asId } from "@nyte-ai/schema";
import { SdkError, TOKEN } from "@nyte-ai/core";
import type { Connection } from "@nyte-ai/core";
import { afterEach, assert, describe, expect, it } from "vitest";
import { connect } from "../src/connect.ts";
import { BASE, TOKEN_SECRET, operationOf, served } from "./served.ts";
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

function kept(connection: Connection): Connection {
  cleanups.push(() => connection.close());

  return connection;
}

async function failure(run: () => Promise<unknown>): Promise<SdkError> {
  try {
    await run();
  } catch (error) {
    if (error instanceof SdkError) return error;

    throw error;
  }

  throw new Error("Expected an SdkError.");
}

describe("connect", () => {
  it("connects with a token: the host's id, the token principal, the credential as given", async () => {
    const host = await open();
    const credentials = { kind: "token", token: TOKEN_SECRET } as const;
    const connection = kept(await connect({ url: BASE, credentials, fetch: host.fetch }));

    expect(connection.hostId).toBe(host.host.hostId);
    expect(connection.principal).toBe(TOKEN);
    expect(connection.credential).toBe(credentials);
    expect((await connection.workspaces.list()).length).toBe(1);
  });

  it("rejects a credential the host refuses as unauthenticated, and an unreachable URL as unavailable", async () => {
    const host = await open();

    const refused = await failure(() =>
      connect({ url: BASE, credentials: { kind: "token", token: "wrong" }, fetch: host.fetch }),
    );

    const unreachable = await failure(() =>
      connect({
        url: BASE,
        credentials: { kind: "token", token: TOKEN_SECRET },
        fetch: async () => {
          throw new TypeError("fetch failed");
        },
      }),
    );

    expect([refused.code, unreachable.code]).toEqual(["unauthenticated", "unavailable"]);
  });

  it("reads custom headers again for every request", async () => {
    const host = await open();
    let reads = 0;

    const connection = kept(
      await connect({
        url: BASE,
        fetch: host.fetch,
        credentials: {
          kind: "custom",
          headers: () => {
            reads += 1;

            return { Authorization: `Bearer ${TOKEN_SECRET}` };
          },
        },
      }),
    );

    const before = reads;
    await connection.sessions.list();
    await connection.workspaces.list();

    expect(reads).toBe(before + 2);
  });

  it("exchanges a pairing code once for a device token that becomes the credential and is kept", async () => {
    const host = await open();

    const { code } = await host.host.principals.pair({
      authority: new Set(["participant"]),
      label: "phone",
    });

    const sent: string[] = [];

    host.intercept((request, next) => {
      sent.push(request.headers.get("Authorization")?.split(" ")[0] ?? "");

      return next(request);
    });

    const options = {
      url: BASE,
      credentials: { kind: "pairing", code },
      fetch: host.fetch,
    } as const;

    const first = kept(await connect(options));

    assert(first.credential.kind === "token");
    expect(first.principal).not.toBe(TOKEN);
    await first.sessions.list();

    expect(sent).toEqual(["Pairing", "Bearer"]);

    const again = kept(await connect(options));

    expect(again.credential).toEqual(first.credential);
    expect(again.principal).toBe(first.principal);
    expect(sent.at(-1)).toBe("Bearer");
  });

  it("verifies the identity challenge and pins the host: another id or a forged signature is stale", async () => {
    const host = await open({ identity: true });
    const credentials = { kind: "token", token: TOKEN_SECRET } as const;
    const pin = { hostId: host.host.hostId };
    const pinned = kept(await connect({ url: BASE, credentials, fetch: host.fetch, expect: pin }));

    expect(pinned.hostId).toBe(host.host.hostId);

    const other = await failure(() =>
      connect({ url: BASE, credentials, fetch: host.fetch, expect: { hostId: asId("other") } }),
    );

    expect(other.code).toBe("stale");
    expect(other.hostId).toBe(host.host.hostId);

    host.intercept(async (request, next) => {
      const response = await next(request);

      if (new URL(request.url).pathname !== "/.nyte/identity") return response;
      const body: unknown = await response.json();
      assert(typeof body === "object" && body !== null && "signature" in body);
      assert(typeof body.signature === "string");
      const flipped = body.signature.startsWith("A") ? "B" : "A";

      return Response.json({ ...body, signature: flipped + body.signature.slice(1) });
    });

    const forged = await failure(() =>
      connect({ url: BASE, credentials, fetch: host.fetch, expect: pin }),
    );

    expect(forged.code).toBe("stale");
  });

  it("pins by the answering id when the host serves no identity challenge", async () => {
    const host = await open();
    const credentials = { kind: "token", token: TOKEN_SECRET } as const;

    const stale = await failure(() =>
      connect({ url: BASE, credentials, fetch: host.fetch, expect: { hostId: asId("other") } }),
    );

    expect(stale).toMatchObject({ code: "stale", hostId: host.host.hostId });

    const pinned = kept(
      await connect({
        url: BASE,
        credentials,
        fetch: host.fetch,
        expect: { hostId: host.host.hostId },
      }),
    );

    expect(pinned.hostId).toBe(host.host.hostId);
  });

  it("names the operation each request posts", async () => {
    const host = await open();
    const names: string[] = [];

    host.intercept((request, next) => {
      names.push(operationOf(request));

      return next(request);
    });

    const connection = kept(
      await connect({
        url: BASE,
        credentials: { kind: "token", token: TOKEN_SECRET },
        fetch: host.fetch,
      }),
    );

    await connection.sessions.list();

    expect(names).toEqual(["connection.watch", "sessions.list"]);
  });
});
