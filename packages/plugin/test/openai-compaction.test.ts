import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { buffer } from "node:stream/consumers";
import { isDeepStrictEqual } from "node:util";
import { zstdDecompressSync } from "node:zlib";
import { afterEach, test } from "vitest";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { projectUsage } from "@nyte-ai/core/views";
import type { Nyte, SessionEvent, SessionId, StreamFn } from "@nyte-ai/core";
import { openaiCodexProvider, openaiProvider, type AuthResult, type Models } from "@nyte-ai/ai";
import { inlinePlugin, systemPromptPlugin } from "@nyte-ai/plugin";
import type { Api, JsonValue, Model } from "@nyte-ai/schema";
import { activate } from "../../core/src/kernel/sdk/activation.ts";
import { writeCheckpoint } from "../../core/src/kernel/compaction.ts";
import { openaiCompactionPlugin } from "../src/openai-compaction.ts";
import { lastAssistantText, prompt, testModel, TestWorkspace } from "./host.ts";

const servers: Server[] = [];
const workspaces: TestWorkspace[] = [];
afterEach(async () => {
  for (const world of workspaces.splice(0)) await world.close();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

const requestSchema = Type.Object({
  model: Type.String(),
  input: Type.Array(
    Type.Object({
      type: Type.Optional(Type.String()),
      role: Type.Optional(Type.String()),
    }),
  ),
  stream: Type.Optional(Type.Boolean()),
  instructions: Type.Optional(Type.String()),
});

interface CapturedRequest {
  readonly kind: "native" | "summary" | "assistant";
  readonly path: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: Static<typeof requestSchema>;
  readonly input: Static<typeof requestSchema>["input"];
}

function sse(events: { [key: string]: JsonValue }[]) {
  return {
    contentType: "text/event-stream",
    body: events
      .map((event, sequence_number) => `data: ${JSON.stringify({ ...event, sequence_number })}\n\n`)
      .join(""),
  };
}

function assistantPayload(text: string, inputTokens: number) {
  const item = {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const response = {
    id: "resp_fixture",
    object: "response",
    created_at: 1,
    model: testModel.id,
    status: "completed",
    output: [item],
    error: null,
    incomplete_details: null,
    usage: {
      input_tokens: inputTokens,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 10,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: inputTokens + 10,
    },
  };
  return sse([
    { type: "response.created", response: { ...response, status: "in_progress", output: [] } },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: text,
    },
    {
      type: "response.output_text.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text,
    },
    {
      type: "response.content_part.done",
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: item.content[0] ?? null,
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ]);
}

async function endpoint(
  native: { contentType: string; body: string },
  options: {
    status?: number;
    delayMs?: number;
    delayKind?: CapturedRequest["kind"];
    threshold?: boolean;
    nativeRecovery?: ReturnType<typeof sse>;
    summary?: ReturnType<typeof sse>;
  } = {},
) {
  const requests: CapturedRequest[] = [];
  const received = Promise.withResolvers<void>();
  const summarizing = Promise.withResolvers<void>();
  const server = createServer((request, response) => {
    void buffer(request)
      .then((bytes) => {
        const text =
          request.headers["content-encoding"] === "zstd"
            ? zstdDecompressSync(bytes).toString("utf8")
            : bytes.toString("utf8");
        const body: unknown = JSON.parse(text);
        assert.ok(Value.Check(requestSchema, body));
        const input = body.input;
        const last = input.at(-1);
        const kind =
          request.url === "/v1/responses/compact" || last?.type === "compaction_trigger"
            ? "native"
            : text.includes("summarization assistant")
              ? "summary"
              : "assistant";
        requests.push({ kind, path: request.url, headers: request.headers, body, input });
        if (kind === "native") {
          received.resolve();
        }
        if (kind === "summary") summarizing.resolve();
        const payload =
          kind === "native"
            ? requests.filter((entry) => entry.kind === "native").length > 1
              ? (options.nativeRecovery ?? native)
              : native
            : kind === "summary" && options.summary !== undefined
              ? options.summary
              : assistantPayload(
                  kind === "summary"
                    ? "Portable summary: preserve the migration plan."
                    : "Project answer",
                  options.threshold === true &&
                    kind === "assistant" &&
                    text.includes("remember this")
                    ? 99_950
                    : 20,
                );
        response.writeHead(kind === "native" ? (options.status ?? 200) : 200, {
          "content-type": payload.contentType,
          "retry-after-ms": "0",
        });
        if (kind !== (options.delayKind ?? "native") || options.delayMs === undefined) {
          response.end(payload.body);
          return;
        }
        response.write(": waiting for compaction\n\n");
        const heartbeat = setInterval(() => response.write(": still working\n\n"), 5_000);
        const finish = setTimeout(() => response.end(payload.body), options.delayMs);
        response.on("close", () => {
          clearInterval(heartbeat);
          clearTimeout(finish);
        });
      })
      .catch((cause) =>
        response.destroy(cause instanceof Error ? cause : new Error(String(cause))),
      );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  servers.push(server);
  const address = server.address();
  assert.ok(
    Value.Check(
      Type.Object({ address: Type.String(), family: Type.String(), port: Type.Number() }),
      address,
    ),
  );
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    received: received.promise,
    summarizing: summarizing.promise,
  };
}

// Codex V2 returns output_item.done followed by response.completed, not unary JSON.
function nativePayload(
  provider: "openai" | "openai-codex",
  result: { output: JsonValue[]; usage?: JsonValue },
) {
  if (provider === "openai") {
    return { contentType: "application/json", body: JSON.stringify(result) };
  }
  const response = { id: "native-compaction", status: "completed", output: result.output };
  return sse([
    ...result.output.map((item, output_index) => ({
      type: "response.output_item.done",
      output_index,
      item,
    })),
    {
      type: "response.completed",
      response: result.usage === undefined ? response : { ...response, usage: result.usage },
    },
  ]);
}

function token(): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "local-account" } }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

async function open(
  provider: "openai" | "openai-codex" | "other",
  baseUrl: string,
  nativeHandlers = 1,
) {
  const model: Model<Api> = {
    ...testModel,
    provider,
    cost: { input: 1_000_000, output: 2_000_000, cacheRead: 3_000_000, cacheWrite: 4_000_000 },
    api: provider === "openai-codex" ? "openai-codex-responses" : "openai-responses",
    baseUrl: `${baseUrl}/${provider === "openai-codex" ? "backend-api/codex" : "v1"}`,
  };
  const auth: AuthResult = {
    auth: {
      apiKey: provider === "openai-codex" ? token() : "local-api-key",
      baseUrl: model.baseUrl,
      headers: { "x-auth-scope": "model-account" },
    },
  };
  const models: Pick<Models, "getModel" | "getAuth"> = {
    getModel: (requested, id) => (requested === provider && id === model.id ? model : undefined),
    getAuth: async () => auth,
  };
  const plugin = inlinePlugin(openaiCompactionPlugin({ models }));
  const codex = openaiCodexProvider();
  const publicApi = openaiProvider();
  const streamFn: StreamFn = (used, context, options) =>
    used.api === "openai-codex-responses"
      ? codex.stream({ ...used, api: "openai-codex-responses" }, context, {
          ...options,
          ...auth.auth,
          transport: "sse",
        })
      : publicApi.streamSimple({ ...used, api: "openai-responses" }, context, {
          ...options,
          ...auth.auth,
        });
  const world = TestWorkspace.create("nyte-openai-compaction-");
  workspaces.push(world);
  const sdk = await world.open({
    model,
    compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
    plugins: [
      inlinePlugin(systemPromptPlugin("Project instructions")),
      plugin,
      ...Array.from({ length: nativeHandlers - 1 }, (_, index) =>
        inlinePlugin({
          ...openaiCompactionPlugin({ models }),
          id: `native-recovery-${index}`,
        }),
      ),
    ],
    streamFn,
  });
  return { sdk, world, plugin, model, streamFn };
}

async function checkpoints(world: TestWorkspace) {
  const session = await world.store.open(world.sessionId);
  try {
    return (await session.objects.commits()).flatMap(({ commit }) =>
      commit.body.kind === "checkpoint" ? [commit.body] : [],
    );
  } finally {
    await session.close();
  }
}

async function diagnosticsDuring(sdk: Nyte, world: TestWorkspace, action: () => Promise<void>) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(40_000)]);
  const ready = Promise.withResolvers<void>();
  const diagnostics: Extract<SessionEvent, { kind: "diagnostic" }>[] = [];
  const consuming = (async () => {
    try {
      for await (const event of sdk.watch({ sessionId: world.sessionId, live: true, signal })) {
        if (event.kind === "synced") ready.resolve();
        if (event.kind === "diagnostic") diagnostics.push(event);
      }
    } finally {
      ready.reject(new Error("watch stopped before syncing"));
    }
  })();
  try {
    await ready.promise;
    await action();
  } finally {
    controller.abort();
    await consuming;
  }
  return diagnostics;
}

async function watchReplayUntilSynced(
  sdk: Nyte,
  sessionId: SessionId,
  afterSeq: SessionEvent["seq"],
) {
  const signal = AbortSignal.timeout(40_000);
  const seen: SessionEvent[] = [];
  for await (const event of sdk.watch({ sessionId, afterSeq, signal })) {
    seen.push(event);
    if (event.kind === "synced") break;
  }
  return seen;
}

function compactionEvents(events: readonly SessionEvent[]) {
  return events.filter(
    (event): event is Extract<SessionEvent, { kind: "compaction" }> => event.kind === "compaction",
  );
}

for (const mode of ["manual", "threshold"] as const) {
  test.each(["openai", "openai-codex"] as const)(
    `%s ${mode} compaction persists and replays native context without a summary request`,
    async (provider) => {
      const output: JsonValue[] = [
        ...(provider === "openai"
          ? [{ type: "message", role: "user", content: [{ type: "input_text", text: "retained" }] }]
          : []),
        { type: "compaction", encrypted_content: "opaque-native-state" },
      ];
      const remote = await endpoint(
        nativePayload(provider, {
          output,
          usage: { input_tokens: 70, output_tokens: 30, total_tokens: 100 },
        }),
        { threshold: mode === "threshold" },
      );
      const { sdk, world } = await open(provider, remote.baseUrl);
      await prompt(sdk, world.sessionId, "remember this");
      assert.equal(await lastAssistantText(sdk, world.sessionId), "Project answer");
      assert.deepEqual(await checkpoints(world), []);
      const diagnostics = await diagnosticsDuring(sdk, world, async () => {
        if (mode === "manual") {
          const compacted = await sdk.runs.compact({
            sessionId: world.sessionId,
            customInstructions: "Preserve the database migration plan.",
          });
          assert.equal(compacted.kind, "compacted");
        }
        await prompt(sdk, world.sessionId, "continue");
      });
      assert.deepEqual(diagnostics, []);
      assert.equal(await lastAssistantText(sdk, world.sessionId), "Project answer");
      assert.equal(remote.requests.filter((request) => request.kind === "summary").length, 0);
      const native = remote.requests.filter((request) => request.kind === "native");
      assert.equal(native.length, 1);
      const request = native[0];
      assert.ok(request);
      assert.equal(
        request.path,
        provider === "openai-codex" ? "/backend-api/codex/responses" : "/v1/responses/compact",
      );
      assert.equal(request.headers["x-auth-scope"], "model-account");
      assert.equal(
        request.headers.authorization,
        `Bearer ${provider === "openai-codex" ? token() : "local-api-key"}`,
      );
      if (provider === "openai-codex") {
        assert.equal(request.headers["chatgpt-account-id"], "local-account");
        assert.equal(request.headers.accept, "text/event-stream");
        assert.deepEqual(request.input.at(-1), { type: "compaction_trigger" });
        assert.equal(request.body.stream, true);
      }
      assert.match(JSON.stringify(request.body), /remember this/);
      if (mode === "manual") {
        assert.match(JSON.stringify(request.body), /Preserve the database migration plan/);
      }
      const saved = await checkpoints(world);
      assert.equal(saved.length, 1);
      const checkpoint = saved[0];
      assert.ok(checkpoint);
      assert.equal(checkpoint.summary, "");
      assert.equal(checkpoint.usage?.totalTokens, 100);
      assert.equal(checkpoint.material?.provider, provider);
      assert.match(JSON.stringify(checkpoint.retainedTail), /remember this/);
      const data = checkpoint.material?.data;
      assert.ok(Array.isArray(data));
      for (const item of output) assert.ok(data.some((entry) => isDeepStrictEqual(entry, item)));
      const replay = remote.requests.findLast((entry) => entry.kind === "assistant");
      assert.ok(replay);
      for (const item of data)
        assert.ok(replay.input.some((entry) => isDeepStrictEqual(entry, item)));
      assert.doesNotMatch(JSON.stringify(replay.input), /Project answer|Portable summary/);
      if (mode === "manual") assert.match(JSON.stringify(replay.input), /continue/);
    },
  );

  test.each([
    ["other", "unsupported-provider"],
    ["openai", "failed-endpoint"],
    ["openai", "malformed-response"],
    ["openai-codex", "failed-endpoint"],
    ["openai-codex", "malformed-response"],
  ] as const)(
    `%s %s ${mode} compaction falls back to a durable portable summary`,
    async (provider, failure) => {
      const remote = await endpoint(
        failure === "failed-endpoint"
          ? {
              contentType: "application/json",
              body: JSON.stringify({
                error: {
                  message:
                    provider === "openai-codex"
                      ? `Native endpoint unavailable; Bearer ${token()}; private-compaction-payload`
                      : "Native endpoint unavailable",
                  type: "invalid_request_error",
                },
              }),
            }
          : nativePayload(provider === "openai-codex" ? provider : "openai", { output: [] }),
        { status: failure === "failed-endpoint" ? 404 : 200, threshold: mode === "threshold" },
      );
      const { sdk, world } = await open(provider, remote.baseUrl);
      await prompt(sdk, world.sessionId, "remember this");
      assert.equal(await lastAssistantText(sdk, world.sessionId), "Project answer");
      assert.deepEqual(await checkpoints(world), []);
      const diagnostics = await diagnosticsDuring(sdk, world, async () => {
        if (mode === "manual") {
          assert.equal((await sdk.runs.compact({ sessionId: world.sessionId })).kind, "compacted");
        }
        await prompt(sdk, world.sessionId, "continue");
      });
      assert.equal(await lastAssistantText(sdk, world.sessionId), "Project answer");
      assert.equal(
        remote.requests.filter((request) => request.kind === "native").length,
        failure === "unsupported-provider" ? 0 : 1,
      );
      const summaries = remote.requests.filter((request) => request.kind === "summary");
      assert.ok(summaries.length > 0);
      assert.ok(
        summaries.some((request) => JSON.stringify(request.input).includes("remember this")),
      );
      const saved = await checkpoints(world);
      assert.equal(saved.length, 1);
      assert.equal(saved[0]?.material, undefined);
      assert.match(saved[0]?.summary ?? "", /Portable summary: preserve the migration plan\./);
      assert.ok((saved[0]?.usage?.totalTokens ?? 0) > 0);
      const replay = remote.requests.findLast((entry) => entry.kind === "assistant");
      assert.ok(replay);
      assert.match(JSON.stringify(replay.input), /Portable summary: preserve the migration plan\./);
      assert.match(JSON.stringify(replay.input), /continue/);
      assert.ok(!replay.input.some((item) => item.type === "compaction"));
      if (failure === "unsupported-provider") {
        assert.deepEqual(diagnostics, []);
        return;
      }
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0]?.level, "warn");
      assert.equal(diagnostics[0]?.owner, "compaction");
      assert.match(
        diagnostics[0]?.message ?? "",
        /^Native compaction failed; trying a portable text summary\. .+/,
      );
      assert.doesNotMatch(
        diagnostics[0]?.message ?? "",
        /local-api-key|header\.|private-compaction-payload/,
      );
    },
  );
}

test.each(["openai", "openai-codex"] as const)(
  "%s retains native usage when cancelled after decoding the response without moving the head",
  async (provider) => {
    const remote = await endpoint(
      nativePayload(provider, {
        output: [{ type: "compaction", encrypted_content: "cancelled-native-state" }],
        usage: { input_tokens: 70, output_tokens: 30, total_tokens: 100 },
      }),
    );
    const { sdk, world, plugin, model, streamFn } = await open(provider, remote.baseUrl);
    await prompt(sdk, world.sessionId, "remember this");
    const session = await world.store.open(world.sessionId);
    const tip = await session.refs.read("refs/heads/main");
    const before = await sdk.messages.list({ sessionId: world.sessionId });
    const snapshot = await sdk.sessions.snapshot({ sessionId: world.sessionId });
    assert.ok(snapshot);
    const seq = snapshot.seq;
    const diagnostics = await diagnosticsDuring(sdk, world, async () => {
      const controller = new AbortController();
      const active = await activate({
        target: { kind: "session", session },
        plugins: [plugin],
        env: { cwd: world.directory },
      });
      try {
        const result = await writeCheckpoint(session, {
          head: "main",
          model,
          settings: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
          reason: "manual",
          signal: controller.signal,
          streamFn,
          providerCompaction: async (request, signal) => {
            const checkpoint = await active.hooks.run(
              "before_compaction",
              {
                ...request,
                model: { provider: model.provider, modelId: model.id },
                head: "main",
                runId: "cancel-after-native-result",
              },
              signal,
            );
            // Cancel after real HTTP decoding, at core's publication boundary.
            controller.abort();
            return checkpoint;
          },
        });
        assert.equal(result.kind, "aborted");
      } finally {
        await active.close();
      }
    });
    assert.deepEqual(diagnostics, []);
    const replay = await watchReplayUntilSynced(sdk, world.sessionId, seq);
    assert.equal(remote.requests.filter((request) => request.kind === "native").length, 1);
    assert.equal(remote.requests.filter((request) => request.kind === "summary").length, 0);
    assert.equal(await session.refs.read("refs/heads/main"), tip);
    assert.deepEqual(
      replay.filter(
        (event) =>
          event.kind === "commit" || event.kind === "head_moved" || event.kind === "diagnostic",
      ),
      [],
    );
    const compactions = compactionEvents(replay);
    assert.equal(compactions.length, 2);
    assert.equal(compactions[0]?.compaction?.reason, "manual");
    assert.equal(compactions[1]?.compaction, null);
    assert.equal(replay.at(-1)?.kind, "synced");
    assert.equal(
      (await sdk.sessions.snapshot({ sessionId: world.sessionId }))?.compaction,
      undefined,
    );
    assert.deepEqual(await sdk.messages.list({ sessionId: world.sessionId }), before);
    await session.close();
    const reopened = await world.store.open(world.sessionId);
    try {
      const commits = await reopened.objects.commits();
      assert.ok(commits.every(({ commit }) => commit.body.kind !== "checkpoint"));
      const usage = commits.flatMap(({ commit }) =>
        commit.body.kind === "summary" && commit.body.usage !== undefined
          ? [commit.body.usage]
          : [],
      );
      assert.equal(
        usage.reduce((sum, reported) => sum + reported.totalTokens, 0),
        100,
      );
      assert.equal(await reopened.refs.read("refs/heads/main"), tip);
    } finally {
      await reopened.close();
    }
  },
);

test("Codex compaction can stream beyond the former 30-second total deadline", async () => {
  const remote = await endpoint(
    nativePayload("openai-codex", {
      output: [{ type: "compaction", encrypted_content: "slow-native-state" }],
    }),
    { delayMs: 31_000 },
  );
  const { sdk, world } = await open("openai-codex", remote.baseUrl);
  await prompt(sdk, world.sessionId, "remember this");
  const diagnostics = await diagnosticsDuring(sdk, world, async () => {
    assert.equal((await sdk.runs.compact({ sessionId: world.sessionId })).kind, "compacted");
  });
  assert.deepEqual(diagnostics, []);
  assert.equal(remote.requests.filter((request) => request.kind === "native").length, 1);
  assert.equal(remote.requests.filter((request) => request.kind === "summary").length, 0);
  assert.match(JSON.stringify((await checkpoints(world))[0]?.material?.data), /slow-native-state/);
  await prompt(sdk, world.sessionId, "continue");
  assert.match(
    JSON.stringify(remote.requests.findLast((request) => request.kind === "assistant")?.input),
    /slow-native-state/,
  );
  assert.equal(await lastAssistantText(sdk, world.sessionId), "Project answer");
}, 40_000);

test("cancelling an active Codex compaction stream does not publish, warn, or start portable fallback", async () => {
  const remote = await endpoint(
    nativePayload("openai-codex", {
      output: [{ type: "compaction", encrypted_content: "unpublished-native-state" }],
    }),
    { delayMs: 31_000 },
  );
  const { sdk, world } = await open("openai-codex", remote.baseUrl);
  await prompt(sdk, world.sessionId, "remember this");
  const session = await world.store.open(world.sessionId);
  const tip = await session.refs.read("refs/heads/main");
  const snapshot = await sdk.sessions.snapshot({ sessionId: world.sessionId });
  assert.ok(snapshot);
  const seq = snapshot.seq;
  const controller = new AbortController();
  try {
    const diagnostics = await diagnosticsDuring(sdk, world, async () => {
      const compacting = sdk.runs.compact({
        sessionId: world.sessionId,
        signal: controller.signal,
      });
      await remote.received;
      controller.abort();
      assert.equal((await compacting).kind, "aborted");
    });
    assert.deepEqual(diagnostics, []);
    const replay = await watchReplayUntilSynced(sdk, world.sessionId, seq);
    assert.equal(remote.requests.filter((request) => request.kind === "native").length, 1);
    assert.equal(remote.requests.filter((request) => request.kind === "summary").length, 0);
    assert.deepEqual(await checkpoints(world), []);
    assert.equal(await session.refs.read("refs/heads/main"), tip);
    assert.deepEqual(
      replay.filter(
        (event) =>
          event.kind === "commit" || event.kind === "head_moved" || event.kind === "diagnostic",
      ),
      [],
    );
    const compactions = compactionEvents(replay);
    assert.equal(compactions.length, 2);
    assert.equal(compactions[0]?.compaction?.reason, "manual");
    assert.equal(compactions[1]?.compaction, null);
    assert.equal(replay.at(-1)?.kind, "synced");
    assert.equal(
      (await sdk.sessions.snapshot({ sessionId: world.sessionId }))?.compaction,
      undefined,
    );
    assert.equal(await session.leases.read("refs/heads/main"), undefined);
  } finally {
    controller.abort();
    await session.close();
  }
});

test.each(["manual", "threshold"] as const)(
  "%s compaction counts rejected native usage together with the portable summary",
  async (mode) => {
    const remote = await endpoint(
      nativePayload("openai-codex", {
        output: [],
        usage: { input_tokens: 70, output_tokens: 30, total_tokens: 100 },
      }),
      { threshold: mode === "threshold" },
    );
    const { sdk, world } = await open("openai-codex", remote.baseUrl);
    await prompt(sdk, world.sessionId, "remember this");
    if (mode === "manual") {
      assert.equal((await sdk.runs.compact({ sessionId: world.sessionId })).kind, "compacted");
    }
    await prompt(sdk, world.sessionId, "continue");
    const saved = await checkpoints(world);
    assert.equal(saved.length, 1);
    assert.equal(saved[0]?.material, undefined);
    const summaries = remote.requests.filter((request) => request.kind === "summary").length;
    assert.ok(summaries > 0);
    assert.equal(saved[0]?.usage?.totalTokens, 100 + summaries * 30);
    assert.equal(saved[0]?.usage?.cost.total, 130 + summaries * 40);
  },
);

test.each(["failed", "cancelled"] as const)(
  "a %s portable fallback retains native spend without publishing a checkpoint",
  async (outcome) => {
    const remote = await endpoint(
      nativePayload("openai-codex", {
        output: [],
        usage: { input_tokens: 70, output_tokens: 30, total_tokens: 100 },
      }),
      outcome === "cancelled"
        ? { delayKind: "summary", delayMs: 31_000 }
        : {
            summary: sse([
              {
                type: "response.failed",
                response: {
                  id: "failed-summary",
                  status: "failed",
                  error: { code: "invalid_request", message: "Cannot summarize" },
                  usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
                },
              },
            ]),
          },
    );
    const { sdk, world } = await open("openai-codex", remote.baseUrl);
    await prompt(sdk, world.sessionId, "remember this");
    const session = await world.store.open(world.sessionId);
    const tip = await session.refs.read("refs/heads/main");
    const controller = new AbortController();
    try {
      const compacting = sdk.runs.compact({
        sessionId: world.sessionId,
        signal: controller.signal,
      });
      if (outcome === "cancelled") {
        await remote.summarizing;
        controller.abort();
      }
      assert.equal((await compacting).kind, outcome === "cancelled" ? "aborted" : "failed");
      assert.deepEqual(await checkpoints(world), []);
      assert.equal(await session.refs.read("refs/heads/main"), tip);
      assert.equal(await session.leases.read("refs/heads/main"), undefined);
    } finally {
      controller.abort();
      await session.close();
    }
    const reopened = await world.store.open(world.sessionId);
    try {
      const usage = projectUsage((await reopened.objects.commits()).map(({ commit }) => commit));
      assert.equal(usage.compaction.totalTokens, outcome === "cancelled" ? 100 : 150);
      assert.equal(usage.compaction.cost.total, outcome === "cancelled" ? 130 : 190);
      assert.equal(await reopened.refs.read("refs/heads/main"), tip);
    } finally {
      await reopened.close();
    }
  },
);

test("a later native handler recovers without a fallback warning and retains all reported usage", async () => {
  const remote = await endpoint(
    nativePayload("openai-codex", {
      output: [],
      usage: { input_tokens: 70, output_tokens: 30, total_tokens: 100 },
    }),
    {
      nativeRecovery: nativePayload("openai-codex", {
        output: [{ type: "compaction", encrypted_content: "recovered-state" }],
        usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 },
      }),
    },
  );
  const { sdk, world } = await open("openai-codex", remote.baseUrl, 2);
  await prompt(sdk, world.sessionId, "remember this");
  const diagnostics = await diagnosticsDuring(sdk, world, async () => {
    assert.equal((await sdk.runs.compact({ sessionId: world.sessionId })).kind, "compacted");
    await prompt(sdk, world.sessionId, "continue");
  });
  assert.deepEqual(diagnostics, []);
  assert.equal(remote.requests.filter((request) => request.kind === "summary").length, 0);
  const saved = await checkpoints(world);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.usage?.totalTokens, 150);
  assert.equal(saved[0]?.usage?.cost.total, 190);
  assert.match(JSON.stringify(saved[0]?.material?.data), /recovered-state/);
  assert.match(
    JSON.stringify(remote.requests.findLast((request) => request.kind === "assistant")?.input),
    /recovered-state/,
  );
});

// Lifecycle reference: openai/codex@121f91fd5d9dc66017866ce9bdc49f1e182721df,
// app-server/tests/suite/v2/compaction.rs:
// thread_compact_start_triggers_compaction_and_returns_empty_response.
// Nyte resumes its real SQLite session; the HTTP fixture exercises V2 instead of
// that upstream test's portable summary.
test("a completed native checkpoint survives host restart and is replayed on the next turn", async () => {
  const remote = await endpoint(
    nativePayload("openai-codex", {
      output: [{ type: "compaction", encrypted_content: "resumed-checkpoint" }],
      usage: { input_tokens: 70, output_tokens: 30, total_tokens: 100 },
    }),
  );
  const { sdk, world, model, plugin, streamFn } = await open("openai-codex", remote.baseUrl);
  await prompt(sdk, world.sessionId, "remember this project");
  assert.equal((await sdk.runs.compact({ sessionId: world.sessionId })).kind, "compacted");
  await sdk.close();
  const resumed = await world.open({
    model,
    plugins: [inlinePlugin(systemPromptPlugin("Project instructions")), plugin],
    streamFn,
  });
  await prompt(resumed, world.sessionId, "continue after restart");
  assert.equal(await lastAssistantText(resumed, world.sessionId), "Project answer");
  const replay = remote.requests.findLast((request) => request.kind === "assistant");
  assert.ok(replay);
  assert.match(JSON.stringify(replay.input), /resumed-checkpoint/);
  assert.match(JSON.stringify(replay.input), /remember this project/);
  assert.match(JSON.stringify(replay.input), /continue after restart/);
  assert.doesNotMatch(JSON.stringify(replay.input), /Project answer|Portable summary/);
  assert.equal(remote.requests.filter((request) => request.kind === "native").length, 1);
  assert.equal(remote.requests.filter((request) => request.kind === "summary").length, 0);
  const saved = await checkpoints(world);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.usage?.totalTokens, 100);
});
