import assert from "node:assert/strict";
import { test } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import type { SessionSnapshot } from "@nyte-ai/protocol";
import { sessionId } from "@nyte-ai/protocol";
import { installSnapshotCacheBudget, releaseSessionQueries } from "./snapshot-cache.ts";
import { keys } from "./query-keys.ts";

function snapshot(id: string, name = id): SessionSnapshot {
  return {
    session: {
      sessionId: sessionId(id),
      activation: { kind: "active" },
      name,
      createdAt: 1,
      lastActivityAt: 1,
      pinned: false,
      archived: false,
      heads: [],
      config: {},
    },
    seq: 1,
    head: "main",
    tip: null,
    config: {},
    transcript: [],
    pending: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1_000 },
  };
}

async function enforce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve));
}

test("inactive transcripts stay within the entry and byte budgets", async () => {
  const client = new QueryClient();
  const unsubscribe = installSnapshotCacheBudget(client, { maxEntries: 2, maxBytes: 1_000 });
  client.setQueryData(keys.snapshot(sessionId("one")), snapshot("one", "a".repeat(300)), {
    updatedAt: 1,
  });
  client.setQueryData(keys.snapshot(sessionId("two")), snapshot("two", "b".repeat(300)), {
    updatedAt: 2,
  });
  client.setQueryData(keys.snapshot(sessionId("three")), snapshot("three", "small"), {
    updatedAt: 3,
  });
  await Promise.resolve();
  assert.ok(client.getQueryData(keys.snapshot(sessionId("one"))));
  await enforce();
  const retained = client
    .getQueryCache()
    .getAll()
    .filter((query) => query.queryKey[0] === "snapshot");
  assert.ok(retained.length <= 2);
  assert.equal(
    client.getQueryData<SessionSnapshot>(keys.snapshot(sessionId("three")))?.session.name,
    "small",
  );
  client.setQueryData(
    keys.snapshot(sessionId("three")),
    snapshot("three", "changed".repeat(1_000)),
    { updatedAt: 3 },
  );
  await enforce();
  assert.equal(client.getQueryData(keys.snapshot(sessionId("three"))), undefined);
  unsubscribe();
  client.clear();
});

test("releasing a session drops only what nobody reads", () => {
  const client = new QueryClient();
  const id = sessionId("archived");
  const value = snapshot("archived");
  client.setQueryData(keys.snapshot(id), value);
  client.setQueryData(["vcs", "run-diff", id, "run"], "large diff");
  const observer = new QueryObserver(client, {
    queryKey: keys.snapshot(id),
    queryFn: () => Promise.resolve(value),
    staleTime: Infinity,
  });
  const stop = observer.subscribe(() => {});
  releaseSessionQueries(client, id);
  assert.equal(client.getQueryData(keys.snapshot(id)), value);
  assert.equal(client.getQueryData(["vcs", "run-diff", id, "run"]), undefined);
  stop();
  client.clear();
});

test("the budget never evicts a transcript that still has a reader", async () => {
  const client = new QueryClient();
  const unsubscribeBudget = installSnapshotCacheBudget(client, { maxEntries: 0, maxBytes: 0 });
  const id = sessionId("open");
  const value = snapshot("open", "large".repeat(100));
  client.setQueryData(keys.snapshot(id), value);
  const observer = new QueryObserver(client, {
    queryKey: keys.snapshot(id),
    queryFn: () => Promise.resolve(value),
  });
  const unsubscribeObserver = observer.subscribe(() => {});
  client.setQueryData(keys.snapshot(sessionId("closed")), snapshot("closed"));
  await enforce();
  assert.equal(client.getQueryData(keys.snapshot(id)), value);
  assert.equal(client.getQueryData(keys.snapshot(sessionId("closed"))), undefined);
  unsubscribeObserver();
  await enforce();
  assert.equal(client.getQueryData(keys.snapshot(id)), undefined);
  client.setQueryData(keys.snapshot(id), value);
  unsubscribeBudget();
  await enforce();
  assert.equal(client.getQueryData(keys.snapshot(id)), value);
  client.clear();
});
