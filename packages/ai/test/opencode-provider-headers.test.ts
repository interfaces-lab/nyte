import { normalizeContext } from "@nyte-ai/schema/model";
import { describe, expect, it } from "vitest";
import { withOpenCodeSessionHeader } from "../src/providers/opencode-headers.ts";
import type {
  Api,
  AssistantMessage,
  Model,
  ProviderHeaders,
  ProviderStreams,
  SimpleStreamOptions,
  StreamOptions,
} from "../src/types.ts";
import { AssistantMessageEventStream } from "../src/utils/event-stream.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Test model",
  api: "test-api",
  provider: "opencode",
  baseUrl: "https://opencode.ai/zen/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};
const context = normalizeContext({ messages: [{ role: "user", content: "hi", timestamp: 0 }] });

function completedStream(): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text: "ok" }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: 0,
  };
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: "stop", message });
  stream.end(message);
  return stream;
}

function recordingStreams(capture: (options: StreamOptions | undefined) => void): ProviderStreams {
  return {
    stream: (_model, _context, options) => {
      capture(options);
      return completedStream();
    },
    streamSimple: (_model, _context, options) => {
      capture(options);
      return completedStream();
    },
  };
}

describe("OpenCode provider headers", () => {
  it.each<{
    name: string;
    method: "stream" | "streamSimple";
    options: SimpleStreamOptions;
    expected: ProviderHeaders;
  }>([
    {
      name: "maps sessionId for stream requests even without cache retention",
      method: "stream",
      options: { sessionId: "conversation-1", cacheRetention: "none" },
      expected: { "x-opencode-session": "conversation-1" },
    },
    {
      name: "maps sessionId for streamSimple requests even without cache retention",
      method: "streamSimple",
      options: { sessionId: "conversation-1", cacheRetention: "none" },
      expected: { "x-opencode-session": "conversation-1" },
    },
    {
      name: "preserves a case-insensitive caller override",
      method: "streamSimple",
      options: { sessionId: "generated-value", headers: { "X-OpenCode-Session": "caller-value" } },
      expected: { "X-OpenCode-Session": "caller-value" },
    },
    {
      name: "preserves a case-insensitive caller removal",
      method: "streamSimple",
      options: { sessionId: "generated-value", headers: { "X-OpenCode-Session": null } },
      expected: { "X-OpenCode-Session": null },
    },
    {
      name: "does not fabricate a session header when sessionId is absent",
      method: "streamSimple",
      options: { headers: { "x-custom": "value" } },
      expected: { "x-custom": "value" },
    },
  ])("$name", (input) => {
    let captured: StreamOptions | undefined;
    const streams = withOpenCodeSessionHeader(
      recordingStreams((options) => {
        captured = options;
      }),
    );

    streams[input.method](model, context, input.options);

    expect(captured?.headers).toEqual(input.expected);
  });
});
