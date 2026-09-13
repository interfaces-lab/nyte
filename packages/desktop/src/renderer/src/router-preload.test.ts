import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import type { SessionId, SessionInfo } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/protocol";
import { test } from "vitest";
import { readRouteSession } from "./route-session.ts";
import { keys } from "./query-keys.ts";

function session(id: SessionId): SessionInfo {
  return {
    sessionId: id,
    activation: { kind: "active" },
    name: id,
    createdAt: 1,
    lastActivityAt: 1,
    pinned: false,
    archived: false,
    heads: [],
    config: {},
  };
}

test("overlapping intent and navigation share one SDK read and cache its result", async () => {
  const id = sessionId("preloaded-chat");
  const info = session(id);
  const response = Promise.withResolvers<SessionInfo | undefined>();
  let reads = 0;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const read = () => {
    reads += 1;
    return response.promise;
  };
  try {
    const intent = readRouteSession({ client, sessionId: id, read });
    const navigation = readRouteSession({ client, sessionId: id, read });
    response.resolve(info);
    assert.deepEqual(await intent, info);
    assert.deepEqual(await navigation, info);
    assert.deepEqual(await readRouteSession({ client, sessionId: id, read }), info);
    assert.deepEqual(client.getQueryData(keys.session(id)), info);
    // SDK request count is the preload contract, not an internal cache call sequence.
    assert.equal(reads, 1);
  } finally {
    client.clear();
  }
});

test("a failed existence read does not prevent a later successful read", async () => {
  const id = sessionId("retry-chat");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await assert.rejects(
      readRouteSession({
        client,
        sessionId: id,
        read: async () => {
          throw new Error("disk unavailable");
        },
      }),
      /disk unavailable/,
    );
    assert.deepEqual(
      await readRouteSession({ client, sessionId: id, read: async () => session(id) }),
      session(id),
    );
  } finally {
    client.clear();
  }
});

test("a missing session remains distinct from an SDK failure", async () => {
  const id = sessionId("missing-chat");
  const client = new QueryClient();
  try {
    assert.equal(
      await readRouteSession({ client, sessionId: id, read: async () => undefined }),
      null,
    );
  } finally {
    client.clear();
  }
});
