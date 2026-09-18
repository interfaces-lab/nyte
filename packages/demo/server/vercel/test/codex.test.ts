import assert from "node:assert/strict";
import { zstdDecompressSync } from "node:zlib";
import { SqliteStore } from "@nyte-ai/core/store";
import { test, vi, type TestContext } from "vitest";
import { createChatSdk, createServerModels } from "../src/chat.ts";

const accountId = "codex-test-account";
const payload = Buffer.from(
  JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } }),
).toString("base64url");
const accessToken = `test.${payload}.signature`;

async function fixture(context: TestContext, access: unknown) {
  const store = new SqliteStore(":memory:");
  const models = createServerModels({ OPENAI_CODEX_ACCESS_TOKEN: access });
  const model = models.getModel("openai-codex", "gpt-5.6-sol");
  assert.ok(model);
  const sdk = await createChatSdk({ store, models, model });
  sdk.attach();
  context.onTestFinished(async () => {
    await sdk.close();
    await store.close();
  });
  const { sessionId } = await sdk.sessions.create({ name: "Codex host test" });
  const before = await sdk.sessions.snapshot({ sessionId });
  assert.ok(before);
  const completion = (async () => {
    for await (const event of sdk.watch({
      sessionId,
      afterSeq: before.seq,
      signal: context.signal,
    })) {
      if (event.kind !== "run") continue;
      const phase = event.run.phase;
      if (phase.kind === "done" || phase.kind === "failed" || phase.kind === "aborted")
        return phase;
    }
    return assert.fail("The watch ended before the run completed");
  })();
  return { sdk, sessionId, completion };
}

test(
  "the host uses a supplied Codex access token and saves the streamed reply",
  { timeout: 10_000 },
  async (context) => {
    // Disable the optional WebSocket transport so only the simulated SSE boundary is used.
    vi.stubGlobal("WebSocket", undefined);
    context.onTestFinished(() => {
      vi.unstubAllGlobals();
    });

    const providerFetch = async (...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      const request = new Request(input, init);
      assert.equal(request.url, "https://chatgpt.com/backend-api/codex/responses");
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("authorization"), `Bearer ${accessToken}`);
      assert.equal(request.headers.get("chatgpt-account-id"), accountId);
      const bytes = new Uint8Array(await request.arrayBuffer());
      const body: unknown = JSON.parse(
        new TextDecoder().decode(
          request.headers.get("content-encoding") === "zstd" ? zstdDecompressSync(bytes) : bytes,
        ),
      );
      assert.partialDeepStrictEqual(body, {
        model: "gpt-5.6-sol",
        stream: true,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: "Say that the Codex connection works." }],
          },
        ],
      });

      const events = [
        {
          type: "response.output_item.added",
          item: {
            type: "message",
            id: "msg_test",
            role: "assistant",
            status: "in_progress",
            content: [],
          },
        },
        { type: "response.content_part.added", part: { type: "output_text", text: "" } },
        { type: "response.output_text.delta", delta: "Codex connection works." },
        {
          type: "response.output_item.done",
          item: {
            type: "message",
            id: "msg_test",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "Codex connection works." }],
          },
        },
        {
          type: "response.completed",
          response: {
            status: "completed",
            usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 },
          },
        },
      ];
      return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const network = vi.fn(providerFetch);
    vi.stubGlobal("fetch", network);
    const { sdk, sessionId, completion } = await fixture(context, accessToken);
    const [phase] = await Promise.all([
      completion,
      sdk.messages.send({ sessionId, content: "Say that the Codex connection works." }),
    ]);
    assert.equal(phase.kind, "done");
    assert.equal(network.mock.calls.length, 1);
    const snapshot = await sdk.sessions.snapshot({ sessionId });
    assert.ok(snapshot);
    assert.deepEqual(
      snapshot.transcript.flatMap((turn) =>
        turn.kind === "turn"
          ? turn.parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
          : [],
      ),
      ["Codex connection works."],
    );
  },
);

for (const access of [undefined, "", 123]) {
  test(
    `a missing or invalid Codex access token fails the run without network access: ${String(access)}`,
    { timeout: 10_000 },
    async (context) => {
      const network = vi.fn(async () => {
        throw new Error("A missing credential must not reach the network");
      });
      vi.stubGlobal("fetch", network);
      context.onTestFinished(() => {
        vi.unstubAllGlobals();
      });
      const { sdk, sessionId, completion } = await fixture(context, access);
      const [phase] = await Promise.all([
        completion,
        sdk.messages.send({ sessionId, content: "Hello" }),
      ]);
      assert.ok(phase.kind === "failed");
      assert.equal(phase.failure.message, "Provider is not configured: openai-codex");
      assert.equal(network.mock.calls.length, 0);
    },
  );
}
