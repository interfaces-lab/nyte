import { describe, expect, it } from "vitest";
import { durableObjectStore } from "../src/durable-object.ts";
import { doSqlStub } from "./do-sql-stub.ts";
import { storeConformance } from "./store-conformance.ts";

/** Returns a fresh store: `durableObjectStore` over a new, empty `node:sqlite` stand-in of a Durable Object's SQL storage (§43i). */
async function fresh() {
  return durableObjectStore(doSqlStub());
}

storeConformance("durableObjectStore over the node:sqlite stand-in (§43i)", fresh);

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
