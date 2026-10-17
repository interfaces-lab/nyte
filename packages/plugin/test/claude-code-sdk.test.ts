import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import type {
  McpSdkServerConfigWithInstance,
  Options,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { createModels } from "@nyte-ai/ai/models";
import { isPart, tool } from "@nyte-ai/core";
import type { Plugin, ToolDefinition } from "@nyte-ai/core";
import { isJson, standard } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, assert, beforeEach, expect, it, vi } from "vitest";
import { claudeCodeSdk } from "../src/claude-code-sdk/index.ts";
import type { StartQuery } from "../src/claude-code-sdk/session.ts";
import { open, testModel } from "./fake-models.ts";

type StreamEvent = Extract<SDKMessage, { type: "stream_event" }>["event"];

type Transport = Parameters<McpSdkServerConfigWithInstance["instance"]["connect"]>[0];

type JsonObject = { readonly [key: string]: Json };

interface Claude {
  readonly options: Options;
  prompt(): Promise<SDKUserMessage | undefined>;
  emit(...messages: readonly SDKMessage[]): void;
  mcp(method: string, params: JsonObject): Promise<Json>;
}

const MODEL = "claude-opus-4-7";

const configuration = { model: { provider: "claude-code", id: MODEL } };

const usage = {
  input_tokens: 10,
  output_tokens: 5,
  cache_creation: null,
  cache_creation_input_tokens: null,
  cache_read_input_tokens: null,
  fallback_credit: null,
  inference_geo: null,
  iterations: null,
  output_tokens_details: null,
  server_tool_use: null,
  service_tier: null,
  speed: null,
} as const;

const response = Type.Object({ id: Type.Number(), result: Type.Unknown() });

const note: ToolDefinition<{ text: string }> = {
  name: "note",
  description: "Pin a note.",
  parameters: standard(Type.Object({ text: Type.String() })),
  class: (args) => ({ kind: "custom", label: `Noting ${args.text}` }),
  effects: "none",
  replay: "safe",
  execute: async (args) => ({ content: [{ kind: "text", text: `Pinned ${args.text}.` }] }),
};

const tools: Plugin<"core"> = { id: "tools", contribute: { tools: [note] } };

beforeEach(() => {
  vi.stubEnv("CLAUDE_CONFIG_DIR", tmpdir());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function stream(event: StreamEvent): SDKMessage {
  return {
    type: "stream_event",
    event,
    parent_tool_use_id: null,
    uuid: randomUUID(),
    session_id: "claude",
  };
}

function begin(): SDKMessage {
  return stream({
    type: "message_start",
    message: {
      id: `msg_${randomUUID()}`,
      type: "message",
      role: "assistant",
      content: [],
      model: MODEL,
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      container: null,
      context_management: null,
      diagnostics: null,
      usage,
    },
  });
}

function toolUse(index: number, id: string, name: string, input: JsonObject): SDKMessage[] {
  return [
    stream({
      type: "content_block_start",
      index,
      content_block: { type: "tool_use", id, name, input: {} },
    }),
    stream({
      type: "content_block_delta",
      index,
      delta: { type: "input_json_delta", partial_json: JSON.stringify(input) },
    }),
    stream({ type: "content_block_stop", index }),
  ];
}

function text(index: number, value: string): SDKMessage[] {
  return [
    stream({
      type: "content_block_start",
      index,
      content_block: { type: "text", text: "", citations: null },
    }),
    stream({ type: "content_block_delta", index, delta: { type: "text_delta", text: value } }),
    stream({ type: "content_block_stop", index }),
  ];
}

function end(reason: "tool_use" | "end_turn"): SDKMessage[] {
  return [
    stream({
      type: "message_delta",
      delta: { stop_reason: reason, stop_sequence: null, container: null, stop_details: null },
      usage: {
        input_tokens: null,
        output_tokens: 5,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
        fallback_credit: null,
        iterations: null,
        output_tokens_details: null,
        server_tool_use: null,
      },
      context_management: null,
    }),
    stream({ type: "message_stop" }),
  ];
}

function toolResult(id: string, content: string, failed: boolean): SDKMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: id, content, is_error: failed }],
    },
    parent_tool_use_id: null,
    session_id: "claude",
  };
}

function finished(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: "",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    usage: {
      ...usage,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      inference_geo: "",
      iterations: [],
      output_tokens_details: { thinking_tokens: 0 },
      server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
      service_tier: "standard",
      speed: "standard",
    },
    modelUsage: {},
    permission_denials: [],
    uuid: randomUUID(),
    session_id: "claude",
  };
}

function fakeClaude(script: (claude: Claude) => Promise<void>) {
  const ran = Promise.withResolvers<void>();

  const start: StartQuery = ({ prompt, options }) => {
    const queue: SDKMessage[] = [];
    let wake: (() => void) | undefined;
    let ended = false;

    const push = (message?: SDKMessage) => {
      if (message === undefined) ended = true;
      else queue.push(message);
      wake?.();
    };

    assert(!Value.Check(Type.String(), prompt) && options !== undefined);
    const prompts = prompt[Symbol.asyncIterator]();
    const server = options.mcpServers?.nyte;
    assert(server?.type === "sdk");
    const replies = new Map<number, (result: Json) => void>();

    const transport: Transport = {
      start: async () => undefined,
      close: async () => undefined,
      send: async (message) => {
        if (Value.Check(response, message) && isJson(message.result))
          replies.get(message.id)?.(message.result);
      },
    };

    const connected = server.instance.connect(transport);
    let next = 0;

    const claude: Claude = {
      options,
      prompt: async () => (await prompts.next()).value ?? undefined,
      emit: (...messages) => {
        for (const message of messages) push(message);
      },
      mcp: async (method, params) => {
        await connected;
        const id = next;
        next += 1;
        const answered = Promise.withResolvers<Json>();
        replies.set(id, answered.resolve);
        transport.onmessage?.({ jsonrpc: "2.0", id, method, params });

        return answered.promise;
      },
    };

    script(claude).then(ran.resolve, ran.reject);

    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const message = queue.shift();

          if (message !== undefined) {
            yield message;
            continue;
          }

          if (ended) return;
          await new Promise<void>((resolve) => (wake = resolve));
        }
      },
      applyFlagSettings: async () => undefined,
      close: () => push(),
    };
  };

  return { start, done: ran.promise };
}

async function openClaude(start: StartQuery, plugins: readonly Plugin<"core">[]) {
  const claudeCode = claudeCodeSdk(start);
  const models = createModels();
  models.setProvider({
    ...claudeCode.provider,
    getModels: () => [
      testModel(MODEL, {
        provider: "claude-code",
        api: "claude-agent-sdk",
        baseUrl: "process://claude-code",
      }),
    ],
  });

  return open({ models, requests: [], reply: () => undefined }, [claudeCode.plugin, ...plugins]);
}

it("runs a Nyte tool Claude Code calls through the nyte MCP server as the session's own call", async () => {
  let listed: Json = null;
  let called: Json = null;

  const claude = fakeClaude(async (fake) => {
    await fake.prompt();
    listed = await fake.mcp("tools/list", {});
    fake.emit(begin(), ...toolUse(0, "toolu_note", "mcp__nyte__note", { text: "hi" }));
    fake.emit(...end("tool_use"));

    called = await fake.mcp("tools/call", {
      name: "note",
      arguments: { text: "hi" },
      _meta: { "claudecode/toolUseId": "toolu_note" },
    });

    fake.emit(toolResult("toolu_note", "Pinned hi.", false));
    fake.emit(begin(), ...text(0, "Pinned it."), ...end("end_turn"), finished());
  });

  await using host = await openClaude(claude.start, [tools]);
  const { session, receipt } = await host.sessions.start({ content: "Pin hi.", configuration });
  const settled = await receipt.settled();
  await claude.done;

  assert(settled.kind === "completed");
  expect(listed).toMatchObject({
    tools: expect.arrayContaining([
      expect.objectContaining({
        name: "note",
        inputSchema: expect.objectContaining({ type: "object" }),
      }),
    ]),
  });
  expect(called).toEqual({ content: [{ type: "text", text: "Pinned hi." }], isError: false });

  const calls = (await session.view()).messages.filter((message) => isPart(message, tool));

  expect(calls).toHaveLength(1);
  const [call] = calls;
  assert(call !== undefined && isPart(call, tool) && call.state.phase === "settled");
  expect(call.state).toMatchObject({
    name: "note",
    args: { text: "hi" },
    class: { kind: "custom", label: "Noting hi" },
    outcome: { kind: "ok", content: [{ kind: "text", text: "Pinned hi." }] },
  });
});
