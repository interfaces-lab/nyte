import { SdkError } from "@nyte-ai/core";
import { envelope, kvRef, memoryStore } from "@nyte-ai/core/store";
import type { Store } from "@nyte-ai/core";
import { describe, expect, it } from "vitest";
import { storedAccounts } from "../../ai/test/credential-fixture.ts";
import { credentialStore, openSecret, sealSecret } from "../src/credentials.ts";

const key = (fill: number) => ({ key: async () => new Uint8Array(32).fill(fill) });

describe("credentialStore", () => {
  it("migrates an encrypted single credential and lists multiple accounts without its key", async () => {
    const store = memoryStore();
    const legacy = { type: "api_key", key: "legacy-secret" };

    const [iv = "", ciphertext = ""] = (await sealSecret(key(1), JSON.stringify(legacy))).split(
      ".",
    );

    const connection = await store.open();

    const target = await connection.objects.put(
      envelope("kv", { type: "api_key", iv, ciphertext }, Date.now()),
    );

    await connection.refs.set([{ name: kvRef("secret", "models", "p"), target }]);
    const credentials = credentialStore(store, key(1));
    expect(await credentials.read("p")).toEqual(
      storedAccounts({ type: "api_key", key: "legacy-secret" }),
    );
    await credentials.modify("p", async (current) => ({
      active: "work",
      accounts: [
        ...(current?.accounts ?? []),
        { id: "work", label: "Work", credential: { type: "api_key", key: "work-secret" } },
      ],
    }));

    const withoutKey = credentialStore(store, {
      key: async () => {
        throw new Error("No secrets key");
      },
    });

    expect(await withoutKey.list()).toEqual([
      { providerId: "p", id: "default", label: "Default", type: "api_key", active: false },
      { providerId: "p", id: "work", label: "Work", type: "api_key", active: true },
    ]);
    expect(await withoutKey.read("p")).toBeUndefined();
  });

  it("round-trips, lists and deletes credentials encrypted at rest", async () => {
    const store = memoryStore();
    const credentials = credentialStore(store, key(1));

    expect(await credentials.read("anthropic")).toBeUndefined();
    await credentials.modify("anthropic", async () =>
      storedAccounts({ type: "api_key", key: "sk-secret" }),
    );
    await credentials.modify("openai", async () =>
      storedAccounts({
        type: "oauth",
        access: "a",
        refresh: "r",
        expires: 5,
        accountId: "acct",
      }),
    );

    expect(await credentials.read("anthropic")).toEqual(
      storedAccounts({ type: "api_key", key: "sk-secret" }),
    );
    expect(await credentials.read("openai")).toEqual(
      storedAccounts({
        type: "oauth",
        access: "a",
        refresh: "r",
        expires: 5,
        accountId: "acct",
      }),
    );
    expect(await credentials.list()).toEqual([
      { providerId: "anthropic", type: "api_key", id: "default", label: "Default", active: true },
      { providerId: "openai", type: "oauth", id: "default", label: "Default", active: true },
    ]);

    const connection = await store.open();
    const ref = await connection.refs.get(kvRef("secret", "models", "anthropic"));
    const stored = ref?.target ? await connection.objects.get(ref.target) : null;

    expect(JSON.stringify(stored)).not.toContain("sk-secret");

    await credentials.delete("anthropic");
    expect(await credentials.read("anthropic")).toBeUndefined();
    expect(await credentials.list()).toEqual([
      { providerId: "openai", type: "oauth", id: "default", label: "Default", active: true },
    ]);
  });

  it("modifies on the current credential and keeps it when fn returns undefined", async () => {
    const credentials = credentialStore(memoryStore(), key(1));
    await credentials.modify("p", async () => storedAccounts({ type: "api_key", key: "one" }));
    const seen: unknown[] = [];

    const kept = await credentials.modify("p", async (current) => {
      seen.push(current);

      return undefined;
    });

    expect(seen).toEqual([storedAccounts({ type: "api_key", key: "one" })]);
    expect(kept).toEqual(storedAccounts({ type: "api_key", key: "one" }));
  });

  it("reads another instance's write and runs fn again on stale, then gives up after 5 retries", async () => {
    const inner = memoryStore();
    let sets = 0;

    const stale: Store = {
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

        return storedAccounts({ type: "api_key", key: "k" });
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SdkError);
    expect(failure).toMatchObject({ code: "unavailable" });
    expect(sets).toBe(6);
    expect(runs).toHaveLength(6);
  });

  it("reads a record sealed under another key as absent; without a key, read is undefined and modify rejects", async () => {
    const store = memoryStore();
    await credentialStore(store, key(1)).modify("p", async () =>
      storedAccounts({ type: "api_key", key: "k" }),
    );

    expect(await credentialStore(store, key(2)).read("p")).toBeUndefined();

    const locked = credentialStore(store, {
      key: async () => {
        throw new SdkError("unavailable", "No key.");
      },
    });

    expect(await locked.read("p")).toBeUndefined();
    expect(await locked.list()).toEqual([
      { providerId: "p", type: "api_key", id: "default", label: "Default", active: true },
    ]);
    await expect(locked.modify("p", async () => undefined)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("calls key() only once a record exists: not for read or list of an empty store (§50b)", async () => {
    let reads = 0;

    const credentials = credentialStore(memoryStore(), {
      key: async () => {
        reads += 1;

        return new Uint8Array(32).fill(5);
      },
    });

    expect(await credentials.read("p")).toBeUndefined();
    expect(await credentials.list()).toEqual([]);
    expect(reads).toBe(0);
    await credentials.modify("p", async () => storedAccounts({ type: "api_key", key: "k" }));

    expect(reads).toBe(1);
  });

  it("never calls key() to list, nor to read a provider without a record, while other records exist (§55)", async () => {
    const store = memoryStore();
    await credentialStore(store, key(5)).modify("p", async () =>
      storedAccounts({ type: "api_key", key: "k" }),
    );
    let reads = 0;

    const credentials = credentialStore(store, {
      key: async () => {
        reads += 1;

        return new Uint8Array(32).fill(5);
      },
    });

    expect(await credentials.list()).toEqual([
      { providerId: "p", type: "api_key", id: "default", label: "Default", active: true },
    ]);
    expect(await credentials.read("q")).toBeUndefined();
    expect(reads).toBe(0);
    expect(await credentials.read("p")).toEqual(storedAccounts({ type: "api_key", key: "k" }));
    expect(reads).toBe(1);
  });

  it("seals a secret under the key and opens it only with that key", async () => {
    const sealed = await sealSecret(key(1), "client.token");

    expect(sealed).not.toContain("client.token");
    expect(await openSecret(key(1), sealed)).toBe("client.token");
    await expect(openSecret(key(2), sealed)).rejects.toThrow();
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
      credentials.modify("p", async () => storedAccounts({ type: "api_key", key: "k" })),
    ).rejects.toMatchObject({ code: "unavailable" });
    ready = true;
    await credentials.modify("p", async () => storedAccounts({ type: "api_key", key: "k" }));

    expect(await credentials.read("p")).toEqual(storedAccounts({ type: "api_key", key: "k" }));
  });
});
