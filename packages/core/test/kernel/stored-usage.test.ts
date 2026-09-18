import assert from "node:assert/strict";
import { test } from "vitest";
import { headRef } from "../../src/kernel/names.ts";
import { projectUsage } from "@nyte-ai/client";
import { assistant, commit, message, openStore, storePath, usage } from "./helpers.ts";

test("recorded usage survives rewind and reopen, including loose compaction usage", async () => {
  const path = storePath();
  const store = openStore(path);
  const session = await store.create();
  const [first] = await session.objects.put([commit(null, message(assistant("first")), { at: 1 })]);
  assert.ok(first);
  const [second] = await session.objects.put([
    commit(first, message(assistant("second")), { at: 2 }),
  ]);
  assert.ok(second);
  await session.refs.update([{ name: headRef("main"), from: null, to: second }], {
    reason: "respond",
  });
  await session.refs.update([{ name: headRef("other"), from: null, to: second }], {
    reason: "branch",
  });
  const failedSummary = commit(second, { kind: "summary", text: "", usage }, { at: 3 });
  await session.objects.put([failedSummary, failedSummary, { kind: "blob", value: "metadata" }]);
  await session.refs.update(
    [
      { name: headRef("main"), from: second, to: first },
      { name: headRef("other"), from: second, to: null },
    ],
    { reason: "rewind" },
  );
  const id = session.id;
  await session.close();
  await store.close();

  const reopened = await openStore(path).open(id);
  try {
    const commits = await reopened.objects.commits();
    const summary = projectUsage(commits.map((entry) => entry.commit));
    assert.equal(commits.length, 3);
    assert.equal(summary.total.totalTokens, 45);
    assert.equal(summary.models[0]?.turns, 2);
    assert.equal(summary.compaction.totalTokens, 15);
    assert.equal(await reopened.refs.read(headRef("main")), first);
  } finally {
    await reopened.close();
  }
});
