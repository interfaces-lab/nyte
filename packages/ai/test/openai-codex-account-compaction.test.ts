import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { zstdDecompressSync } from "node:zlib";
import { describe, expect, test } from "vitest";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Context, JsonValue, Model } from "../src/types.ts";
import {
  compactOpenAICodexContext,
  OpenAICodexCompactionError,
  fetchOpenAICodexAccountLimits,
  stream,
} from "../src/api/openai-codex-responses.ts";

// Behavior references, not a vendored suite:
// https://github.com/openai/codex/tree/121f91fd5d9dc66017866ce9bdc49f1e182721df/codex-rs
// core/tests/suite/compact_remote.rs: remote_compact_v2_reuses_compaction_trigger_for_followups,
// remote_compact_v2_accepts_additional_output_items_before_compaction,
// remote_compact_v2_retries_failures_with_stream_retry_budget.
// core/src/compact_remote_v2.rs: retained_history_truncation_keeps_newest_messages_first.
// core/src/compact_remote_v2_image_budget_tests.rs: image_only_boundary_is_atomic_and_does_not_backfill_older_messages.
// app-server/tests/suite/v2/compaction.rs: thread_compact_start_triggers_compaction_and_returns_empty_response
// checks terminal usage and the next request. App-server transport/notifications belong to Nyte's callers.

function model(baseUrl: string): Model<"openai-codex-responses"> {
  return {
    id: "gpt-5.4",
    name: "gpt-5.4",
    api: "openai-codex-responses",
    provider: "openai-codex",
    baseUrl,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1 },
    contextWindow: 100_000,
    maxTokens: 10_000,
  };
}

const apiKey = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(
  JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account-1" } }),
).toString("base64url")}.signature`;
const context: Context = {
  systemPrompt: "private agent instructions",
  messages: [{ role: "user", content: "old conversation", timestamp: 1 }],
};
const image = {
  type: "image",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  mimeType: "image/png",
} as const;
const checkpoint = { type: "compaction", id: "cmp_1", encrypted_content: "opaque-checkpoint" };
const terminalUsage = {
  input_tokens: 100,
  output_tokens: 20,
  total_tokens: 130,
  input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 },
  output_tokens_details: { reasoning_tokens: 5 },
};

function itemDone(item: JsonValue = checkpoint) {
  return { type: "response.output_item.done", output_index: 0, item };
}

function completed(usage: JsonValue = terminalUsage) {
  return {
    type: "response.completed",
    response: { id: "resp_compact", status: "completed", usage },
  };
}

function sse(...events: unknown[]): string {
  return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
}

async function serve(
  respond: (response: ServerResponse, index: number) => void | ServerResponse | Promise<void>,
) {
  const requests: Array<{ path: string; headers: IncomingHttpHeaders; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        assert.ok(Buffer.isBuffer(chunk));
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const text = (
        request.headers["content-encoding"] === "zstd" ? zstdDecompressSync(bytes) : bytes
      ).toString();
      const body: unknown = text ? JSON.parse(text) : undefined;
      requests.push({ path: request.url ?? "", headers: request.headers, body });
      response.setHeader("content-type", "text/event-stream");
      await respond(response, requests.length - 1);
    } catch {
      response.destroy();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(Value.Check(Type.Object({ port: Type.Number() }), address));
  return {
    model: model(`http://127.0.0.1:${address.port}`),
    requests,
    async [Symbol.asyncDispose]() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

function parseRequestInput(body: unknown): unknown[] {
  assert.ok(Value.Check(Type.Object({ input: Type.Array(Type.Unknown()) }), body));
  return body.input;
}

// Parse the persisted provider-owned JSON before handing it back to the adapter.
const savedWindow = Type.Array(
  Type.Union([
    Type.Object({
      type: Type.Literal("message"),
      role: Type.Literal("user"),
      content: Type.Array(
        Type.Union([
          Type.Object({ type: Type.Literal("input_text"), text: Type.String() }),
          Type.Object({
            type: Type.Literal("input_image"),
            image_url: Type.String(),
            detail: Type.Literal("auto"),
          }),
        ]),
      ),
    }),
    Type.Object({
      type: Type.Literal("compaction"),
      id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      encrypted_content: Type.String(),
    }),
  ]),
);

async function persist(
  result: Awaited<ReturnType<typeof compactOpenAICodexContext>>,
): Promise<Context["checkpoint"]> {
  const directory = await mkdtemp(join(tmpdir(), "nyte-codex-compact-"));
  try {
    const file = join(directory, "checkpoint.json");
    await writeFile(file, JSON.stringify(result.data));
    const data: unknown = JSON.parse(await readFile(file, "utf8"));
    assert.ok(Value.Check(savedWindow, data));
    return {
      type: "provider",
      provider: "openai-codex",
      api: "openai-codex-responses",
      model: "gpt-5.4",
      data,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const userInput = (text: string) => ({ role: "user", content: [{ type: "input_text", text }] });
const retainedUser = (text: string) => ({ type: "message", ...userInput(text) });

describe("Codex V2 compaction", () => {
  test("persists retained inputs and one checkpoint, then replays them in a real next request", async () => {
    await using server = await serve((response, index) => {
      if (index === 0) {
        response.end(
          sse(
            { type: "response.created", response: { usage: { total_tokens: 999_999 } } },
            itemDone({ type: "message", content: "ignored compact reply" }),
            itemDone(),
            completed(),
          ),
        );
      } else response.end(sse(completed()));
    });
    const result = await compactOpenAICodexContext(server.model, context, {
      apiKey,
      sessionId: "session-1",
      headers: { "x-codex-beta-features": "another_feature" },
      onPayload: (body) => {
        assert.deepEqual(parseRequestInput(body).at(-1), { type: "compaction_trigger" });
      },
    });
    assert.deepEqual(result.data, [retainedUser("old conversation"), checkpoint]);
    expect(result.usage).toMatchObject({
      input: 60,
      output: 20,
      cacheRead: 30,
      cacheWrite: 10,
      reasoning: 5,
      totalTokens: 130,
    });
    expect(result.usage?.cost.total).toBeCloseTo(0.000113, 12);
    assert.equal(server.requests[0].path, "/codex/responses");
    assert.equal(server.requests[0].headers["chatgpt-account-id"], "account-1");
    assert.equal(server.requests[0].headers["session-id"], "session-1");
    assert.equal(
      server.requests[0].headers["x-codex-beta-features"],
      "another_feature,remote_compaction_v2",
    );
    expect(server.requests[0].body).toMatchObject({
      stream: true,
      store: false,
      instructions: context.systemPrompt,
    });
    assert.deepEqual(parseRequestInput(server.requests[0].body), [
      userInput("old conversation"),
      { type: "compaction_trigger" },
    ]);
    const saved = await persist(result);
    const next = await stream(
      server.model,
      {
        checkpoint: saved,
        messages: [{ role: "user", content: "continue", timestamp: 2 }],
      },
      { apiKey, transport: "sse" },
    ).result();
    assert.equal(next.stopReason, "stop");
    assert.ok(Array.isArray(result.data));
    assert.deepEqual(parseRequestInput(server.requests[1].body), [
      ...result.data,
      userInput("continue"),
    ]);
    await assert.rejects(
      compactOpenAICodexContext(
        { ...server.model, id: "gpt-5.5" },
        {
          checkpoint: saved,
          messages: [],
        },
        { apiKey },
      ),
      /Checkpoint material does not match/,
    );
  });

  test("repeated compaction retains users and images, not old checkpoints or tool history", async () => {
    await using server = await serve((response, index) =>
      response.end(
        sse(itemDone({ ...checkpoint, encrypted_content: `opaque-${index}` }), completed()),
      ),
    );
    const initial: Context = {
      ...context,
      messages: [
        { role: "user", content: [{ type: "text", text: "look" }, image], timestamp: 1 },
        {
          role: "toolResult",
          toolCallId: "call-1",
          toolName: "view_image",
          content: [image],
          isError: false,
          timestamp: 2,
        },
      ],
    };
    const first = await compactOpenAICodexContext(server.model, initial, { apiKey });
    const second = await compactOpenAICodexContext(
      server.model,
      {
        checkpoint: await persist(first),
        messages: [{ role: "user", content: "again", timestamp: 3 }],
      },
      { apiKey },
    );
    assert.deepEqual(second.data, [
      {
        type: "message",
        role: "user",
        content: [
          { type: "input_text", text: "look" },
          { type: "input_image", image_url: `data:image/png;base64,${image.data}`, detail: "auto" },
        ],
      },
      retainedUser("again"),
      { ...checkpoint, encrypted_content: "opaque-1" },
    ]);
    assert.deepEqual(parseRequestInput(server.requests[1].body).slice(-3), [
      { ...checkpoint, encrypted_content: "opaque-0" },
      userInput("again"),
      { type: "compaction_trigger" },
    ]);
  });

  test("keeps the newest 64k tokens, middle-truncating only the boundary message", async () => {
    await using server = await serve((response) => response.end(sse(itemDone(), completed())));
    const result = await compactOpenAICodexContext(
      server.model,
      {
        messages: [
          { role: "user", content: "discard", timestamp: 1 },
          { role: "user", content: "middle1234", timestamp: 2 },
          { role: "user", content: "n".repeat(63_998 * 4), timestamp: 3 },
        ],
      },
      { apiKey },
    );
    assert.deepEqual(result.data, [
      retainedUser("midd…1 tokens truncated…1234"),
      retainedUser("n".repeat(63_998 * 4)),
      checkpoint,
    ]);
  });

  test("UTF-8 boundary truncation does not split characters", async () => {
    await using server = await serve((response) => response.end(sse(itemDone(), completed())));
    const result = await compactOpenAICodexContext(
      server.model,
      {
        messages: [
          { role: "user", content: "😀😀😀😀😀", timestamp: 1 },
          { role: "user", content: "n".repeat(63_997 * 4), timestamp: 2 },
        ],
      },
      { apiKey },
    );
    assert.deepEqual(result.data, [
      retainedUser("😀…2 tokens truncated…😀"),
      retainedUser("n".repeat(63_997 * 4)),
      checkpoint,
    ]);
  });

  test("charges images atomically and never backfills an oversized boundary with older users", async () => {
    await using server = await serve((response) => response.end(sse(itemDone(), completed())));
    for (const remaining of [1844, 1843]) {
      const result = await compactOpenAICodexContext(
        server.model,
        {
          messages: [
            { role: "user", content: "old", timestamp: 1 },
            { role: "user", content: [image], timestamp: 2 },
            { role: "user", content: "n".repeat((64_000 - remaining) * 4), timestamp: 3 },
          ],
        },
        { apiKey },
      );
      const expected = [retainedUser("n".repeat((64_000 - remaining) * 4)), checkpoint];
      assert.deepEqual(
        result.data,
        remaining === 1844
          ? [
              {
                type: "message",
                role: "user",
                content: [
                  {
                    type: "input_image",
                    image_url: `data:image/png;base64,${image.data}`,
                    detail: "auto",
                  },
                ],
              },
              ...expected,
            ]
          : expected,
      );
    }
  });

  test("an image boundary retains later parts, while text-only boundaries retain earlier parts", async () => {
    await using server = await serve((response) => response.end(sse(itemDone(), completed())));
    const result = await compactOpenAICodexContext(
      server.model,
      {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "earlier" }, image, { type: "text", text: "keep" }],
            timestamp: 1,
          },
          { role: "user", content: "n".repeat(63_999 * 4), timestamp: 2 },
        ],
      },
      { apiKey },
    );
    assert.deepEqual(result.data, [
      retainedUser("keep"),
      retainedUser("n".repeat(63_999 * 4)),
      checkpoint,
    ]);
  });

  test("repeated image-heavy compaction keeps charging retained images", async () => {
    await using server = await serve((response, index) =>
      response.end(
        sse(itemDone({ ...checkpoint, encrypted_content: `opaque-${index}` }), completed()),
      ),
    );
    const messages: Context["messages"] = Array.from({ length: 36 }, (_, index) => ({
      role: "user",
      content: [{ type: "text", text: String(index) }, image],
      timestamp: index,
    }));
    const first = await compactOpenAICodexContext(server.model, { messages }, { apiKey });
    assert.ok(Value.Check(savedWindow, first.data));
    assert.equal(first.data.length, 35);
    expect(first.data[0]).toMatchObject({
      content: [{ type: "input_text", text: "2" }, { type: "input_image" }],
    });
    const second = await compactOpenAICodexContext(
      server.model,
      {
        checkpoint: await persist(first),
        messages: [{ role: "user", content: [{ type: "text", text: "36" }, image], timestamp: 36 }],
      },
      { apiKey },
    );
    assert.ok(Value.Check(savedWindow, second.data));
    assert.equal(second.data.length, 35);
    expect(second.data[0]).toMatchObject({
      content: [{ type: "input_text", text: "3" }, { type: "input_image" }],
    });
    expect(second.data.at(-2)).toMatchObject({
      content: [{ type: "input_text", text: "36" }, { type: "input_image" }],
    });
    assert.deepEqual(second.data.at(-1), { ...checkpoint, encrypted_content: "opaque-1" });
  });

  test.each([
    ["missing completion", sse(itemDone())],
    [
      "missing response ID",
      sse(itemDone(), { type: "response.completed", response: { status: "completed" } }),
    ],
    [
      "contradictory status",
      sse(itemDone(), { type: "response.completed", response: { id: "r", status: "failed" } }),
    ],
    [
      "failed",
      sse(itemDone(), {
        type: "response.failed",
        response: { error: { message: "secret prompt" } },
      }),
    ],
    [
      "incomplete",
      sse(itemDone(), { type: "response.incomplete", response: { status: "incomplete" } }),
    ],
    ["error", sse({ type: "error", message: "secret prompt" })],
    ["malformed JSON", 'data: {"secret prompt"\n\n'],
    ["negative usage", sse(itemDone(), completed({ ...terminalUsage, input_tokens: -1 }))],
    ["fractional usage", sse(itemDone(), completed({ ...terminalUsage, output_tokens: 0.5 }))],
    ["partial usage", sse(itemDone(), completed({ total_tokens: 120 }))],
    [
      "invalid cache usage",
      sse(
        itemDone(),
        completed({ ...terminalUsage, input_tokens_details: { cached_tokens: "secret prompt" } }),
      ),
    ],
  ])("rejects %s without leaking provider payloads", async (name, wire) => {
    await using server = await serve((response) => {
      response.setHeader("x-request-id", "req_failure");
      response.end(wire);
    });
    await assert.rejects(
      compactOpenAICodexContext(server.model, context, {
        apiKey,
        maxRetries: name === "missing completion" ? 0 : 2,
      }),
      (error) => {
        assert.ok(error instanceof OpenAICodexCompactionError);
        assert.match(error.message, /HTTP 200/);
        assert.match(error.message, /request ID req_failure/);
        assert.ok(!JSON.stringify(error).includes("secret prompt"));
        assert.ok(!error.message.includes("secret prompt"));
        assert.equal(error.cause, undefined);
        if (name.includes("usage")) assert.equal(error.usage, undefined);
        return true;
      },
    );
    assert.equal(server.requests.length, 1);
  });

  test.each([
    ["missing checkpoint", []],
    ["duplicate checkpoint", [itemDone(), itemDone()]],
    ["invalid checkpoint", [itemDone({ type: "compaction", encrypted_content: 42 })]],
    ["empty checkpoint", [itemDone({ type: "compaction", encrypted_content: "" })]],
    ["invalid output item", [itemDone(null)]],
  ])("preserves terminal usage after %s without retrying", async (_name, items) => {
    await using server = await serve(async (response) => {
      response.setHeader("x-request-id", "req_failure");
      response.write(sse(...items));
      await setTimeout(10);
      response.end(sse(completed()));
    });
    await assert.rejects(
      compactOpenAICodexContext(server.model, context, { apiKey, maxRetries: 2 }),
      (error) => {
        assert.ok(error instanceof OpenAICodexCompactionError);
        assert.match(error.message, /HTTP 200/);
        assert.match(error.message, /request ID req_failure/);
        assert.ok(!JSON.stringify(error).includes("secret prompt"));
        assert.ok(!error.message.includes("secret prompt"));
        expect(error.usage).toMatchObject({
          input: 60,
          output: 20,
          cacheRead: 30,
          cacheWrite: 10,
          reasoning: 5,
          totalTokens: 130,
        });
        expect(error.usage?.cost.total).toBeCloseTo(0.000113, 12);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
    assert.equal(server.requests.length, 1);
  });

  test.each([
    "response.failed",
    "response.incomplete",
    "response.cancelled",
    "response.done",
    "response.completed",
  ])("accounts for %s usage even when the checkpoint cannot be accepted", async (type) => {
    await using server = await serve((response) =>
      response.end(
        sse(itemDone(), {
          type,
          response: {
            id: "r",
            status: "failed",
            usage: terminalUsage,
            service_tier: "priority",
            error: { code: "invalid_request_error", message: `${context.systemPrompt} ${apiKey}` },
          },
        }),
      ),
    );
    await assert.rejects(
      compactOpenAICodexContext(server.model, context, { apiKey, maxRetries: 2 }),
      (error) => {
        assert.ok(error instanceof OpenAICodexCompactionError);
        assert.equal(error.usage?.totalTokens, 130);
        expect(error.usage?.cost.total).toBeCloseTo(0.000226, 12);
        assert.ok(!JSON.stringify(error).includes(apiKey));
        assert.ok(!error.message.includes(context.systemPrompt ?? "private"));
        assert.equal(error.cause, undefined);
        return true;
      },
    );
    assert.equal(server.requests.length, 1);
  });

  test("keeps missing failure usage unknown and explicit zero usage known", async () => {
    await using server = await serve((response, index) =>
      response.end(
        sse({
          type: "response.failed",
          response: {
            usage: index === 0 ? null : { input_tokens: 0, output_tokens: 0, total_tokens: 0 },
          },
        }),
      ),
    );
    for (const hasUsage of [false, true]) {
      await assert.rejects(
        compactOpenAICodexContext(server.model, context, { apiKey }),
        (error) => {
          assert.ok(error instanceof OpenAICodexCompactionError);
          assert.equal(error.usage?.totalTokens, hasUsage ? 0 : undefined);
          return true;
        },
      );
    }
  });

  test("retries a 503 then accepts valid SSE with the configured budget", async () => {
    await using server = await serve((response, index) => {
      if (index === 0) {
        response.writeHead(503, { "retry-after-ms": "10" });
        response.end("private upstream error");
        return;
      }
      response.end(sse(itemDone(), completed()));
    });
    const result = await compactOpenAICodexContext(server.model, context, {
      apiKey,
      maxRetries: 2,
    });
    assert.equal(server.requests.length, 2);
    assert.deepEqual(server.requests[1].body, server.requests[0].body);
    assert.deepEqual(result.data, [retainedUser("old conversation"), checkpoint]);
    assert.equal(result.usage?.totalTokens, 130);
  });

  test("shares the retry budget across failed HTTP opens and interrupted streams", async () => {
    await using server = await serve((response, index) => {
      response.setHeader("retry-after-ms", "10");
      if (index === 0) {
        response.writeHead(500);
        response.end("private upstream error");
        return;
      }
      if (index === 1) {
        response.end(sse(itemDone({ ...checkpoint, encrypted_content: "discarded-attempt" })));
        return;
      }
      response.end(sse(itemDone(), completed()));
    });
    const result = await compactOpenAICodexContext(server.model, context, {
      apiKey,
      maxRetries: 2,
    });
    assert.equal(server.requests.length, 3);
    for (const request of server.requests) {
      assert.equal(request.path, "/codex/responses");
      assert.deepEqual(request.body, server.requests[0].body);
    }
    assert.deepEqual(result.data, [retainedUser("old conversation"), checkpoint]);
    assert.equal(result.usage?.totalTokens, 130);
  });

  test.each([0, 2])("stops after %s retries on retryable status failures", async (maxRetries) => {
    await using server = await serve((response) => {
      response.writeHead(503, { "retry-after-ms": "10" });
      response.end("private upstream error");
    });
    await assert.rejects(
      compactOpenAICodexContext(server.model, context, { apiKey, maxRetries }),
      /HTTP 503/,
    );
    assert.equal(server.requests.length, maxRetries + 1);
  });

  test.each(["headers", "body"])("retries a disconnected %s transport", async (phase) => {
    await using server = await serve(async (response, index) => {
      if (index === 0) {
        if (phase === "body") {
          response.write(sse(itemDone({ ...checkpoint, encrypted_content: "discarded-attempt" })));
          await setTimeout(20);
        }
        response.destroy();
        return;
      }
      response.end(sse(itemDone(), completed()));
    });
    const result = await compactOpenAICodexContext(server.model, context, {
      apiKey,
      maxRetries: 1,
    });
    assert.equal(server.requests.length, 2);
    assert.deepEqual(result.data, [retainedUser("old conversation"), checkpoint]);
  });

  test.each([false, true])(
    "retries a stalled %s-header request with a fresh timeout",
    async (sendHeaders) => {
      await using server = await serve((response, index) => {
        if (index === 0) {
          if (sendHeaders) response.flushHeaders();
          return;
        }
        response.end(sse(itemDone(), completed()));
      });
      const result = await compactOpenAICodexContext(server.model, context, {
        apiKey,
        maxRetries: 1,
        timeoutMs: 100,
      });
      assert.equal(server.requests.length, 2);
      assert.deepEqual(result.data, [retainedUser("old conversation"), checkpoint]);
    },
  );

  test.each(["success", "failure", "invalid usage", "missing usage"])(
    "sums usage and per-attempt pricing across retries ending in %s",
    async (outcome) => {
      await using server = await serve((response, index) => {
        response.setHeader("retry-after-ms", "10");
        const failed = index === 0 || outcome === "failure";
        response.end(
          sse(itemDone(), {
            type: failed ? "response.failed" : "response.completed",
            response: {
              id: "r",
              status: failed ? "failed" : "completed",
              error: failed ? { code: "server_error", message: "secret prompt" } : null,
              usage:
                index === 1 && outcome === "invalid usage"
                  ? { total_tokens: -1 }
                  : index === 1 && outcome === "missing usage"
                    ? null
                    : terminalUsage,
              service_tier: index === 0 ? "priority" : "flex",
            },
          }),
        );
      });
      let result:
        | Awaited<ReturnType<typeof compactOpenAICodexContext>>
        | OpenAICodexCompactionError;
      try {
        result = await compactOpenAICodexContext(server.model, context, {
          apiKey,
          maxRetries: 1,
        });
      } catch (error) {
        assert.ok(error instanceof OpenAICodexCompactionError);
        assert.ok(outcome === "failure" || outcome === "invalid usage");
        assert.ok(!JSON.stringify(error).includes("secret prompt"));
        assert.equal(error.cause, undefined);
        result = error;
      }
      assert.equal(
        result instanceof OpenAICodexCompactionError,
        outcome === "failure" || outcome === "invalid usage",
      );
      const reports = outcome === "invalid usage" || outcome === "missing usage" ? 1 : 2;
      expect(result.usage).toMatchObject({
        input: 60 * reports,
        output: 20 * reports,
        cacheRead: 30 * reports,
        cacheWrite: 10 * reports,
        reasoning: 5 * reports,
        totalTokens: 130 * reports,
      });
      expect(result.usage?.cost.total).toBeCloseTo(0.000113 * (reports === 1 ? 2 : 2.5), 12);
      assert.equal(server.requests.length, 2);
    },
  );

  test.each(["server delay", "backoff"])("honors the retry delay cap for %s", async (kind) => {
    await using server = await serve((response) => {
      response.writeHead(503, kind === "server delay" ? { "retry-after-ms": "5000" } : {});
      response.end();
    });
    await assert.rejects(
      compactOpenAICodexContext(server.model, context, {
        apiKey,
        maxRetries: 2,
        maxRetryDelayMs: 50,
      }),
      /retry delay/i,
    );
    assert.equal(server.requests.length, 1);
  });

  test.each([
    ["retry-after-ms", "80"],
    ["retry-after", "0.08"],
  ])("waits for %s with the delay cap disabled", async (header, value) => {
    const requestTimes: number[] = [];
    await using server = await serve((response, index) => {
      requestTimes.push(performance.now());
      if (index === 0) {
        response.writeHead(429, { [header]: value });
        response.end('{"error":{"code":"rate_limit_exceeded"}}');
        return;
      }
      response.end(sse(itemDone(), completed()));
    });
    const result = await compactOpenAICodexContext(server.model, context, {
      apiKey,
      maxRetries: 1,
      maxRetryDelayMs: 0,
    });
    assert.equal(server.requests.length, 2);
    assert.ok(requestTimes[1] - requestTimes[0] >= 70);
    assert.equal(result.usage?.totalTokens, 130);
  });

  test.each([-1, 0.5, NaN, Infinity])(
    "rejects invalid retry budget %s before sending",
    async (maxRetries) => {
      await using server = await serve((response) => response.end(sse(itemDone(), completed())));
      await assert.rejects(
        compactOpenAICodexContext(server.model, context, { apiKey, maxRetries }),
        /Invalid Codex compaction maxRetries/,
      );
      assert.equal(server.requests.length, 0);
    },
  );

  test("does not retry response callback failures as transport errors", async () => {
    await using server = await serve((response) => response.end(sse(itemDone(), completed())));
    await assert.rejects(
      compactOpenAICodexContext(server.model, context, {
        apiKey,
        maxRetries: 2,
        onResponse: () => {
          throw new Error("private overloaded callback failure");
        },
      }),
      (error) => {
        assert.ok(error instanceof OpenAICodexCompactionError);
        assert.ok(!error.message.includes("private overloaded callback failure"));
        assert.equal(error.usage, undefined);
        return true;
      },
    );
    assert.equal(server.requests.length, 1);
  });

  test("cancels retry backoff without losing the failed attempt's usage", async () => {
    const started = Promise.withResolvers<void>();
    await using server = await serve((response) => {
      response.setHeader("retry-after-ms", "5000");
      response.end(
        sse({
          type: "response.failed",
          response: { usage: terminalUsage, error: { code: "server_error" } },
        }),
      );
      started.resolve();
    });
    const controller = new AbortController();
    const result = compactOpenAICodexContext(server.model, context, {
      apiKey,
      maxRetries: 2,
      signal: controller.signal,
    });
    const rejected = assert.rejects(result, (error) => {
      assert.ok(error instanceof OpenAICodexCompactionError);
      assert.match(error.message, /Request was aborted/);
      assert.equal(error.usage?.totalTokens, 130);
      assert.ok(!error.message.includes("private cancellation reason"));
      return true;
    });
    await started.promise;
    await setTimeout(50);
    controller.abort(new Error("private cancellation reason"));
    await rejected;
    assert.equal(server.requests.length, 1);
  });

  test("missing usage stays unknown, and Codex may omit status and item ID", async () => {
    await using server = await serve((response) =>
      response.end(
        sse(itemDone({ type: "compaction", encrypted_content: "opaque" }), {
          type: "response.completed",
          response: { id: "r" },
        }),
      ),
    );
    const result = await compactOpenAICodexContext(server.model, context, { apiKey });
    assert.equal(result.usage, undefined);
    assert.deepEqual(result.data, [
      retainedUser("old conversation"),
      { type: "compaction", encrypted_content: "opaque" },
    ]);
  });

  test("accepts nullable protocol metadata without inventing cache or reasoning usage", async () => {
    await using server = await serve((response) =>
      response.end(
        sse(itemDone({ ...checkpoint, id: null }), {
          type: "response.completed",
          response: {
            id: "r",
            status: "completed",
            service_tier: null,
            usage: { ...terminalUsage, input_tokens_details: null, output_tokens_details: null },
          },
        }),
      ),
    );
    const result = await compactOpenAICodexContext(server.model, context, { apiKey });
    expect(result.usage).toMatchObject({
      input: 100,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      totalTokens: 130,
    });
    assert.deepEqual(result.data, [retainedUser("old conversation"), { ...checkpoint, id: null }]);
  });

  test.each([400, 401, 403, 404, 422, 429])(
    "does not retry HTTP %s or expose its body",
    async (status) => {
      await using server = await serve((response) => {
        response.writeHead(status, { "x-request-id": "req_missing", "retry-after-ms": "1" });
        response.end(
          JSON.stringify({
            error: { message: `insufficient_quota overloaded ${context.systemPrompt} ${apiKey}` },
          }),
        );
      });
      await assert.rejects(
        compactOpenAICodexContext(server.model, context, { apiKey, maxRetries: 2 }),
        (error) => {
          assert.ok(error instanceof OpenAICodexCompactionError);
          assert.ok(error.message.includes(`HTTP ${status}`));
          assert.ok(error.message.includes(`${server.model.baseUrl}/codex/responses`));
          assert.match(error.message, /request ID req_missing/);
          assert.ok(!error.message.includes(apiKey));
          assert.ok(!error.message.includes(context.systemPrompt ?? "private"));
          return true;
        },
      );
      assert.equal(server.requests.length, 1);
    },
  );

  test("heartbeats reset the idle timeout and CRLF frames work across chunk boundaries", async () => {
    await using server = await serve(async (response) => {
      response.flushHeaders();
      for (let i = 0; i < 10; i++) {
        response.write(": heartbeat\r\n\r\n");
        await setTimeout(30);
      }
      const wire = sse(itemDone(), completed()).replaceAll("\n", "\r\n");
      const split = wire.indexOf("\r") + 1;
      response.write(wire.slice(0, split));
      await setTimeout(10);
      response.end(wire.slice(split));
    });
    const result = await compactOpenAICodexContext(server.model, context, {
      apiKey,
      timeoutMs: 150,
    });
    assert.deepEqual(result.data, [retainedUser("old conversation"), checkpoint]);
  });

  test.each([false, true])(
    "times out stalled %s-header streams and releases the connection",
    async (sendHeaders) => {
      const closed = Promise.withResolvers<void>();
      await using server = await serve((response) => {
        response.on("close", closed.resolve);
        if (sendHeaders) response.flushHeaders();
      });
      await assert.rejects(
        compactOpenAICodexContext(server.model, context, { apiKey, timeoutMs: 100 }),
        sendHeaders ? /Stream idle timeout/ : /Response headers timed out/,
      );
      await closed.promise;
    },
  );

  test("finishes at response.completed without waiting for the server to close", async () => {
    const closed = Promise.withResolvers<void>();
    await using server = await serve((response) => {
      response.on("close", closed.resolve);
      response.write(sse(itemDone(), completed()));
    });
    const result = await compactOpenAICodexContext(server.model, context, {
      apiKey,
      timeoutMs: 100,
    });
    assert.deepEqual(result.data, [retainedUser("old conversation"), checkpoint]);
    await closed.promise;
  });

  test("an already-cancelled request never reaches the server", async () => {
    await using server = await serve((response) => response.end(sse(itemDone(), completed())));
    await assert.rejects(
      compactOpenAICodexContext(server.model, context, {
        apiKey,
        signal: AbortSignal.abort(new Error("private cancellation reason")),
        maxRetries: 2,
      }),
      /Request was aborted/,
    );
    assert.equal(server.requests.length, 0);
  });

  test("cancellation interrupts a pending body read and releases the connection", async () => {
    const started = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<void>();
    await using server = await serve((response) => {
      response.on("close", closed.resolve);
      response.write(sse(itemDone()));
      started.resolve();
    });
    const controller = new AbortController();
    const result = compactOpenAICodexContext(server.model, context, {
      apiKey,
      signal: controller.signal,
      maxRetries: 2,
    });
    const rejected = assert.rejects(result, /Request was aborted/);
    await started.promise;
    controller.abort(new Error("private cancellation reason"));
    await rejected;
    await closed.promise;
  });
});

test("Codex subscription windows still come from wham/usage", async () => {
  await using server = await serve((response) =>
    response.end(
      JSON.stringify({
        plan_type: "plus",
        rate_limit: {
          primary_window: {
            used_percent: 28,
            limit_window_seconds: 18_000,
            reset_at: 2_000_000_000,
          },
          secondary_window: {
            used_percent: 56,
            limit_window_seconds: 604_800,
            reset_at: 2_000_100_000,
          },
        },
      }),
    ),
  );
  const limits = await fetchOpenAICodexAccountLimits(server.model, { apiKey });
  assert.equal(server.requests[0].path, "/wham/usage");
  assert.equal(limits.plan, "plus");
  assert.deepEqual(limits.windows, [
    { id: "five_hour", usedPercent: 28, windowMinutes: 300, resetsAt: 2_000_000_000_000 },
    { id: "seven_day", usedPercent: 56, windowMinutes: 10_080, resetsAt: 2_000_100_000_000 },
  ]);
});
