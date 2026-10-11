import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import { SdkError } from "@nyte-ai/sdk";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { test } from "vitest";
import { readRouteSession } from "./route-session.ts";
import { keys } from "./query-keys.ts";

function session(id: SessionId): SessionInfo {
  return {
    id,
    name: id,
    parent: null,
    workspace: asId<"workspace">("fixture"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [],
    createdAt: 1,
    lastActivityAt: 1,
  };
}

test("overlapping intent and navigation share one SDK read and cache its result", async () => {
  const id = asId<"session">("preloaded-chat");
  const info = session(id);
  const response = Promise.withResolvers<SessionInfo>();
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

test("a missing session remains distinct from an SDK failure", async () => {
  const id = asId<"session">("missing-chat");
  const client = new QueryClient();

  try {
    assert.equal(
      await readRouteSession({
        client,
        sessionId: id,
        read: async () => {
          throw new SdkError("unknown", "No such session.");
        },
      }),
      null,
    );
    await assert.rejects(
      readRouteSession({
        client: new QueryClient(),
        sessionId: id,
        read: async () => {
          throw new SdkError("unavailable", "Host down.");
        },
      }),
    );
  } finally {
    client.clear();
  }
});
