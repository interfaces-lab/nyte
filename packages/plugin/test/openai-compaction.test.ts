import assert from "node:assert/strict";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { text } from "node:stream/consumers";
import { afterEach, test } from "vitest";
import type { AuthResult, Context, Models } from "@nyte-ai/ai";
import { inlinePlugin, systemPromptPlugin } from "@nyte-ai/plugin";
import type { Api, Model } from "@nyte-ai/schema";
import { openaiCompactionPlugin } from "../src/openai-compaction.ts";
import { prompt, respond, testModel, TestWorkspace } from "./host.ts";

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
        response.writeHead(status, { "content-type": "application/json", "retry-after-ms": "0" });
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
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests };
}

function token(): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "local-account" } }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

async function open(provider: "openai" | "openai-codex" | "other", baseUrl: string) {
  const model: Model<Api> = {
    ...testModel,
    provider,
    api: provider === "openai-codex" ? "openai-codex-responses" : "openai-responses",
  };
  const auth: AuthResult = {
    auth: {
      apiKey: provider === "openai-codex" ? token() : "local-api-key",
      baseUrl: `${baseUrl}/${provider === "openai-codex" ? "backend-api/codex" : "v1"}`,
      headers: { "x-auth-scope": "model-account" },
    },
  };
  const models: Pick<Models, "getModel" | "getAuth"> = {
    getModel: (requested, id) => (requested === provider && id === model.id ? model : undefined),
    getAuth: async () => auth,
  };
  const contexts: Context[] = [];
  const world = TestWorkspace.create("nyte-openai-compaction-");
  workspaces.push(world);
  const sdk = await world.open({
    model,
    compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
    plugins: [
      inlinePlugin(systemPromptPlugin("Project instructions")),
      inlinePlugin(openaiCompactionPlugin({ models })),
    ],
    streamFn: (used, context) => {
      contexts.push(context);
      return respond(used, [{ type: "text", text: "portable summary or answer" }]);
    },
  });
  return { sdk, world, contexts };
}

test.each(["openai", "openai-codex"] as const)(
  "%s compacts with model auth and replays the full native window without a summary request",
  async (provider) => {
    const output = [
      { type: "message", role: "user", content: [{ type: "input_text", text: "retained" }] },
      { type: "compaction", encrypted_content: "opaque-native-state" },
    ];
    const remote = await endpoint(JSON.stringify({ output }));
    const { sdk, world, contexts } = await open(provider, remote.baseUrl);
    await prompt(sdk, world.sessionId, "remember the project context");
    const before = contexts.length;
    const compacted = await sdk.runs.compact({
      sessionId: world.sessionId,
      customInstructions: "Preserve the database migration plan.",
    });
    assert.equal(compacted.kind, "compacted");
    assert.equal(contexts.length, before);
    assert.equal(remote.requests.length, 1);
    const request = remote.requests[0];
    assert.ok(request);
    assert.equal(
      request.path,
      provider === "openai-codex"
        ? "/backend-api/codex/responses/compact"
        : "/v1/responses/compact",
    );
    assert.equal(request.headers["x-auth-scope"], "model-account");
    assert.equal(
      request.headers.authorization,
      `Bearer ${provider === "openai-codex" ? token() : "local-api-key"}`,
    );
    if (provider === "openai-codex") {
      assert.equal(request.headers["chatgpt-account-id"], "local-account");
    }
    assert.match(request.body, /Preserve the database migration plan/);
    await prompt(sdk, world.sessionId, "continue");
    assert.deepEqual(contexts.at(-1)?.checkpoint?.data, output);
    assert.equal(contexts.at(-1)?.messages.length, 1);
  },
);

test.each(["unsupported-provider", "failed-endpoint", "malformed-response"] as const)(
  "%s uses the portable summarizer",
  async (failure) => {
    const remote = await endpoint(
      JSON.stringify({ output: [] }),
      failure === "failed-endpoint" ? 404 : 200,
    );
    const { sdk, world, contexts } = await open(
      failure === "unsupported-provider" ? "other" : "openai",
      remote.baseUrl,
    );
    await prompt(sdk, world.sessionId, "remember this");
    const before = contexts.length;
    assert.equal((await sdk.runs.compact({ sessionId: world.sessionId })).kind, "compacted");
    assert.ok(contexts.length > before);
    assert.match(contexts.at(-1)?.systemPrompt ?? "", /summarization assistant/);
    assert.equal(remote.requests.length, failure === "unsupported-provider" ? 0 : 1);
  },
);
