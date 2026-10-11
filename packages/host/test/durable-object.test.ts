import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Miniflare } from "miniflare";
import { storeConformance } from "./store-conformance.ts";
import { bundle, remoteStore, startWorker } from "./workerd.ts";

let worker: Miniflare | null = null;

beforeAll(async () => {
  worker = await startWorker(await bundle(new URL("./fixtures/store-worker.ts", import.meta.url)), {
    STORE: { kind: "durable-object", className: "StoreHost" },
  });
}, 120_000);

afterAll(async () => {
  await worker?.dispose();
});

/** Returns a fresh store: a new `StoreHost` object in workerd, its SQLite empty. */
async function fresh() {
  if (worker === null) throw new Error("workerd did not start.");

  return remoteStore(worker, crypto.randomUUID());
}

storeConformance("durableObjectStore under workerd (§42g)", fresh);

describe("durableObjectStore limits (§42k)", () => {
  it("answers invalid for an object or a blob past 2 MB and writes nothing", async () => {
    const connection = await (await fresh()).open();
    const large = "x".repeat(2_000_001);

    await expect(connection.objects.put({ large })).rejects.toMatchObject({ code: "invalid" });
    await expect(
      connection.objects.putBlob(
        (async function* () {
          yield new Uint8Array(2_000_001);
        })(),
      ),
    ).rejects.toMatchObject({ code: "invalid" });
    expect(await connection.refs.list("")).toEqual([]);
  });
});
