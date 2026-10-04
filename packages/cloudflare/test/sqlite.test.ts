import assert from "node:assert/strict";
import { test } from "vitest";
import { SqlStore } from "@nyte-ai/core/store";
import { sqliteFixture } from "./fixture.ts";

test("core deletes more than 500 objects within the DO 100-parameter ceiling", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);
  const session = await store.create();

  const ids = await session.objects.put(
    Array.from({ length: 501 }, (_, n) => ({ kind: "blob", value: { n } })),
  );

  assert.equal(await session.objects.delete(ids), 501);
  assert.equal((await session.objects.list()).length, 0);
});

test("oversized UTF-8 bodies fail before SQL persistence", async (context) => {
  const fixture = sqliteFixture();
  context.onTestFinished(fixture.close);
  const store = new SqlStore(fixture.connection);
  const session = await store.create();
  await assert.rejects(
    session.objects.put([{ kind: "blob", value: { text: "😀".repeat(500_000) } }]),
    RangeError,
  );
  assert.equal((await session.objects.list()).length, 0);
});
