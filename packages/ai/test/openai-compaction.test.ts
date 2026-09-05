import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { text } from "node:stream/consumers";
import { afterEach, test } from "vitest";
import { compactOpenAIResponsesContext } from "../src/api/openai-responses.ts";
import { convertResponsesMessages } from "../src/api/openai-responses-shared.ts";
import type { Model } from "../src/types.ts";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
});

interface CapturedRequest {
  readonly path: string | undefined;
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

function isTcpAddress(address: ReturnType<Server["address"]>): address is AddressInfo {
  return address !== null && typeof address === "object";
}

async function endpoint(payload: string, status = 200) {
  const requests: CapturedRequest[] = [];
  const server = createServer((request, response) => {
    void text(request)
      .then((body) => {
        requests.push({ path: request.url, headers: request.headers, body });
        response.writeHead(status, { "content-type": "application/json" });
        response.end(payload);
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
  assert.ok(isTcpAddress(address));
  const model: Model<"openai-responses"> = {
    id: "test-model",
    name: "Test model",
    api: "openai-responses",
    provider: "openai",
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    reasoning: true,
    input: ["text"],
    cost: { input: 2, output: 8, cacheRead: 1, cacheWrite: 2 },
    contextWindow: 100_000,
    maxTokens: 1_000,
    headers: { "x-model-header": "model" },
  };
  return { model, requests };
}

test("Responses compaction uses API auth and preserves the complete opaque window and usage", async () => {
  const output = [
    { type: "message", role: "user", content: [{ type: "input_text", text: "retained" }] },
    { type: "compaction", encrypted_content: "opaque", future_field: { keep: [1, true, null] } },
  ];
  const { model, requests } = await endpoint(
    JSON.stringify({
      output,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 30 },
        output_tokens_details: { reasoning_tokens: 10 },
      },
    }),
  );
  const compacted = await compactOpenAIResponsesContext(
    model,
    {
      systemPrompt: "Follow the project instructions.",
      messages: [{ role: "user", content: "history", timestamp: 1 }],
    },
    { apiKey: "local-test-key", headers: { "x-auth-header": "auth" }, maxRetries: 0 },
  );
  assert.deepEqual(compacted.data, output);
  assert.equal(compacted.usage?.input, 70);
  assert.equal(compacted.usage?.cacheRead, 30);
  assert.equal(compacted.usage?.output, 20);
  assert.equal(compacted.usage?.reasoning, 10);
  assert.equal(compacted.usage?.totalTokens, 120);
  assert.ok((compacted.usage?.cost.total ?? 0) > 0);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.ok(request);
  assert.equal(request.path, "/v1/responses/compact");
  assert.equal(request.headers.authorization, "Bearer local-test-key");
  assert.equal(request.headers["x-model-header"], "model");
  assert.equal(request.headers["x-auth-header"], "auth");
  assert.deepEqual(JSON.parse(request.body), {
    model: model.id,
    input: [{ role: "user", content: [{ type: "input_text", text: "history" }] }],
    instructions: "Follow the project instructions.",
  });
  assert.deepEqual(
    convertResponsesMessages(
      model,
      {
        checkpoint: {
          type: "provider",
          provider: model.provider,
          api: model.api,
          model: model.id,
          data: compacted.data,
        },
        messages: [],
      },
      new Set(),
    ),
    output,
  );
});

test("an unsupported route rejects without turning the error into a checkpoint", async () => {
  const { model, requests } = await endpoint(
    JSON.stringify({ error: { message: "unsupported" } }),
    404,
  );
  await assert.rejects(
    compactOpenAIResponsesContext(model, { messages: [] }, { apiKey: "test", maxRetries: 0 }),
    /unsupported/,
  );
  assert.equal(requests.length, 1);
});

test.each([
  { output: [] },
  { output: [null] },
  { output: [{ encrypted_content: "missing type" }] },
])("rejects malformed compact output %j", async (payload) => {
  const { model } = await endpoint(JSON.stringify(payload));
  await assert.rejects(
    compactOpenAIResponsesContext(model, { messages: [] }, { apiKey: "test", maxRetries: 0 }),
    /valid output items/,
  );
});
