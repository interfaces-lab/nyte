import { SdkError, kvRef, memoryStore } from "@nyte-ai/core";
import type { Store } from "@nyte-ai/core";
import { describe, expect, it } from "vitest";
import { credentialStore } from "../src/credentials.ts";

const key = (fill: number) => ({ key: async () => new Uint8Array(32).fill(fill) });

describe("credentialStore", () => {
  it("round-trips, lists and deletes credentials encrypted at rest", async () => {
    const store = memoryStore();
    const credentials = credentialStore(store, key(1));

    expect(await credentials.read("anthropic")).toBeUndefined();
    await credentials.modify("anthropic", async () => ({ type: "api_key", key: "sk-secret" }));
    await credentials.modify("openai", async () => ({
      type: "oauth",
      access: "a",
      refresh: "r",
      expires: 5,
      accountId: "acct",
    }));

    expect(await credentials.read("anthropic")).toEqual({ type: "api_key", key: "sk-secret" });
    expect(await credentials.read("openai")).toEqual({
      type: "oauth",
      access: "a",
      refresh: "r",
      expires: 5,
      accountId: "acct",
    });
    expect(await credentials.list()).toEqual([
      { providerId: "anthropic", type: "api_key" },
      { providerId: "openai", type: "oauth" },
    ]);

    const connection = await store.open();
    const ref = await connection.refs.get(kvRef("secret", "models", "anthropic"));
    const stored = ref?.target ? await connection.objects.get(ref.target) : null;

    expect(JSON.stringify(stored)).not.toContain("sk-secret");
    await connection.close();

    await credentials.delete("anthropic");
    expect(await credentials.read("anthropic")).toBeUndefined();
    expect(await credentials.list()).toEqual([{ providerId: "openai", type: "oauth" }]);
  });

  it("modifies on the current credential and keeps it when fn returns undefined", async () => {
    const credentials = credentialStore(memoryStore(), key(1));
    await credentials.modify("p", async () => ({ type: "api_key", key: "one" }));
    const seen: unknown[] = [];

    const kept = await credentials.modify("p", async (current) => {
      seen.push(current);

      return undefined;
    });

    expect(seen).toEqual([{ type: "api_key", key: "one" }]);
    expect(kept).toEqual({ type: "api_key", key: "one" });
  });

  it("reads another instance's write and runs fn again on stale, then gives up after 5 retries", async () => {
    const inner = memoryStore();
    let sets = 0;

    const stale: Store = {
      kind: inner.kind,
      close: () => inner.close(),
      async open() {
        const connection = await inner.open();

        return {
          ...connection,
          refs: {
            ...connection.refs,
            async set(updates) {
              sets += 1;

              return { kind: "stale", name: updates[0]?.name ?? "", revision: null };
            },
          },
        };
      },
    };

    const runs: number[] = [];

    const failure = await credentialStore(stale, key(1))
      .modify("p", async () => {
        runs.push(runs.length);

        return { type: "api_key", key: "k" };
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SdkError);
    expect(failure).toMatchObject({ code: "unavailable" });
    expect(sets).toBe(6);
    expect(runs).toHaveLength(6);
  });

  it("reads a record sealed under another key as absent; without a key, read is undefined and modify rejects", async () => {
    const store = memoryStore();
    await credentialStore(store, key(1)).modify("p", async () => ({ type: "api_key", key: "k" }));

    expect(await credentialStore(store, key(2)).read("p")).toBeUndefined();

    const locked = credentialStore(store, {
      key: async () => {
        throw new SdkError("unavailable", "No key.");
      },
    });

    expect(await locked.read("p")).toBeUndefined();
    expect(await locked.list()).toEqual([{ providerId: "p", type: "api_key" }]);
    await expect(locked.modify("p", async () => undefined)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("reads the key again after a rejection instead of keeping it", async () => {
    let ready = false;

    const credentials = credentialStore(memoryStore(), {
      key: async () => {
        if (!ready) throw new SdkError("unavailable", "Not yet.");

        return new Uint8Array(32).fill(3);
      },
    });

    await expect(
      credentials.modify("p", async () => ({ type: "api_key", key: "k" })),
    ).rejects.toMatchObject({ code: "unavailable" });
    ready = true;
    await credentials.modify("p", async () => ({ type: "api_key", key: "k" }));

    expect(await credentials.read("p")).toEqual({ type: "api_key", key: "k" });
  });
});
