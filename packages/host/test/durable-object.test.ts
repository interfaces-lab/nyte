import { describe, expect, it } from "vitest";
import { durableObjectStore } from "../src/durable-object.ts";
import { doSqlStub } from "./do-sql-stub.ts";
import { storeConformance, storeMigrationConformance } from "./store-conformance.ts";

async function fresh() {
  return durableObjectStore(doSqlStub());
}

storeConformance("durableObjectStore over the node:sqlite stand-in (§43i)", fresh);

storeMigrationConformance(
  "durableObjectStore migrations over the node:sqlite stand-in",
  async () => {
    const storage = doSqlStub();
    const store = durableObjectStore(storage);

    return {
      dialect: "sqlite",
      store,
      exec: async (sql, values = []) => {
        storage.sql.exec(sql, ...values);
      },
      rows: async (sql) => storage.sql.exec(sql).toArray(),
      close: async () => {
        await store.close();
        storage.database.close();
      },
    };
  },
);

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
