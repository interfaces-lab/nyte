import assert from "node:assert/strict";
import { test } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { SessionInfo, SessionSnapshot } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionsBridge } from "../../shared/ipc.ts";
import { keys } from "./query-keys.ts";
import {
  projectSessionConfiguration,
  sessionConfigurationOptions,
} from "./session-configuration.ts";

const id = sessionId("chosen-model");
const selected = { model: { provider: "provider", id: "chosen" }, thinkingLevel: "high" } as const;

function fixture() {
  const client = new QueryClient();
  const session: SessionInfo = {
    sessionId: id,
    activation: { kind: "active" },
    name: "Draft",
    createdAt: 1,
    lastActivityAt: 1,
    pinned: false,
    archived: false,
    heads: [],
    config: { model: { provider: "provider", id: "default" }, thinkingLevel: "off" },
  };
  const snapshot: SessionSnapshot = {
    session,
    seq: 1,
    head: "main",
    tip: null,
    config: session.config,
    transcript: [],
    pending: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
  };
  const response = Promise.withResolvers<Awaited<ReturnType<SessionsBridge["configure"]>>>();
  const requested = Promise.withResolvers<Parameters<SessionsBridge["configure"]>[0]>();
  const versions: string[] = [];
  const mutation = client.getMutationCache().build(
    client,
    sessionConfigurationOptions({
      client,
      sessionId: id,
      sessions: {
        configure: async (input) => {
          requested.resolve(input);
          return response.promise;
        },
      },
      selection: {
        request: () => {
          versions.push("requested");
        },
        acknowledge: () => {
          versions.push("acknowledged");
          return Promise.resolve();
        },
      },
    }),
  );
  const read = () => {
    const cached = client.getQueryData<SessionSnapshot>(keys.snapshot(id));
    assert.ok(cached);
    return projectSessionConfiguration(
      cached.session,
      mutation.state.status === "pending" ? [mutation.state] : [],
    );
  };
  return { client, session, snapshot, response, requested, mutation, read, versions };
}

test("draft choice wins over initial and repeated default snapshots until acknowledgement", async () => {
  const f = fixture();
  const saving = f.mutation.execute(selected);
  assert.deepEqual(await f.requested.promise, { sessionId: id, ...selected });
  // The observer hears of the request before the write, so a read begun
  // earlier cannot answer it; the acknowledgement follows core's reply.
  assert.deepEqual(f.versions, ["requested"]);
  // The first snapshot arrives only after the draft has handed off to a session.
  f.client.setQueryData(keys.snapshot(id), f.snapshot);
  assert.deepEqual(f.read().config, selected);
  f.client.setQueryData(keys.snapshot(id), { ...f.snapshot, seq: 2 });
  assert.deepEqual(f.read().config, selected);
  f.response.resolve({ kind: "queued", change: "configuration-change" });
  await saving;
  assert.deepEqual(f.versions, ["requested", "acknowledged"]);
  assert.deepEqual(f.read().config, selected);
  f.client.clear();
});

test.each(["unknown_model", "unknown_agent"] as const)(
  "%s preserves the latest host state on failure",
  async (kind) => {
    const f = fixture();
    f.client.setQueryData(keys.snapshot(id), f.snapshot);
    const saving = f.mutation.execute(selected);
    const rejected = assert.rejects(saving, /no longer available/u);
    await f.requested.promise;
    f.client.setQueryData(keys.snapshot(id), {
      ...f.snapshot,
      session: { ...f.session, name: "Renamed while saving", config: { thinkingLevel: "medium" } },
    });
    assert.deepEqual(f.read().config, selected);
    f.response.resolve({ kind });
    await rejected;
    assert.equal(f.read().name, "Renamed while saving");
    assert.deepEqual(f.read().config, { thinkingLevel: "medium" });
    f.client.clear();
  },
);

test("a read started before saving cannot restore the default after acknowledgement", async () => {
  const f = fixture();
  f.client.setQueryData(keys.snapshot(id), f.snapshot);
  const staleRead = Promise.withResolvers<SessionSnapshot>();
  const reading = f.client
    .fetchQuery({
      queryKey: keys.snapshot(id),
      queryFn: () => staleRead.promise,
      staleTime: 0,
    })
    .catch(() => undefined);
  const saving = f.mutation.execute(selected);
  await f.requested.promise;
  assert.deepEqual(f.read().config, selected);
  f.response.resolve({ kind: "queued", change: "configuration-change" });
  await saving;
  staleRead.resolve(f.snapshot);
  await reading;
  assert.deepEqual(f.read().config, selected);
  f.client.clear();
});
