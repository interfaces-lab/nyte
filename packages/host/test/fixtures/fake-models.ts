import type { SimpleStreamOptions } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import type { MutableModels } from "@nyte-ai/ai/models";
import { AssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import type { Plugin, Store } from "@nyte-ai/core";
import { composeHost } from "@nyte-ai/core/server";
import type { ComposeOptions } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import type {
  Api,
  AssistantMessage,
  Model,
  TextContent,
  ToolCall,
  TranscriptContext,
} from "@nyte-ai/schema/model";
import { chatOnlyProvider } from "../../src/providers.ts";

export type Block = TextContent | ToolCall;

export interface Reply {
  readonly content?: readonly Block[];
  readonly until?: Promise<void>;
}

export interface Request {
  readonly model: Model<Api>;
  readonly context: TranscriptContext;
  readonly options: SimpleStreamOptions | undefined;
}

export interface FakeModels {
  readonly models: MutableModels;
  readonly requests: Request[];
  reply(...replies: readonly (Reply | ((request: Request) => Reply))[]): void;
}

export const chatOnly: Plugin<"core"> = { id: "chat-only", environment: chatOnlyProvider() };

const model: Model<Api> = {
  id: "model",
  name: "model",
  api: "test-api",
  provider: "test",
  baseUrl: "https://example.test/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 4_096,
};

export function fakeModels(input?: { readonly into?: MutableModels }): FakeModels {
  const queue: (Reply | ((request: Request) => Reply))[] = [];
  const requests: Request[] = [];

  const respond = (
    context: TranscriptContext,
    options: SimpleStreamOptions | undefined,
  ): AssistantMessageEventStream => {
    const request: Request = { model, context, options };
    requests.push(request);
    const next = queue.shift();

    return streamReply(typeof next === "function" ? next(request) : next, options?.signal);
  };

  const models = input?.into ?? createModels();

  models.setProvider({
    id: "test",
    name: "test",
    auth: {
      apiKey: {
        name: "Test key",
        resolve: async () => ({ auth: { apiKey: "key" }, source: "test" }),
      },
    },
    getModels: () => [model],
    stream: (_, context) => respond(context, undefined),
    streamSimple: (_, context, options) => respond(context, options),
  });

  return { models, requests, reply: (...replies) => queue.push(...replies) };
}

export async function open(
  fake: FakeModels,
  options?: {
    readonly plugins?: readonly Plugin<"core">[];
    readonly store?: Store;
    readonly execution?: ComposeOptions["execution"];
    readonly loadPlugins?: ComposeOptions["loadPlugins"];
    readonly poll?: number;
  },
): ReturnType<typeof composeHost> {
  return composeHost({
    store: options?.store ?? memoryStore(),
    models: fake.models,
    plugins: [chatOnly, ...(options?.plugins ?? [])],
    workspace: { kind: "chat-only", locator: null },
    execution: options?.execution,
    loadPlugins: options?.loadPlugins,
    poll: options?.poll,
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });
}

function streamReply(
  reply: Reply | undefined,
  signal: AbortSignal | undefined,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();

  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  void (async () => {
    await Promise.resolve();

    if (reply === undefined) {
      stream.push({
        type: "error",
        reason: "error",
        error: {
          ...message,
          stopReason: "error",
          errorMessage: "No reply was scripted for this request.",
        },
      });

      return;
    }

    stream.push({ type: "start", partial: message });

    for (const [index, block] of (reply.content ?? []).entries()) {
      if (block.type === "toolCall") {
        const toolCall = { ...block };
        message.content.push(toolCall);
        stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
        stream.push({ type: "toolcall_end", contentIndex: index, toolCall, partial: message });
        continue;
      }

      message.content.push({ type: "text", text: block.text });
      stream.push({ type: "text_start", contentIndex: index, partial: message });
      stream.push({ type: "text_delta", contentIndex: index, delta: block.text, partial: message });
      stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: message });
    }

    await reply.until;

    if (signal?.aborted === true) {
      stream.push({
        type: "error",
        reason: "aborted",
        error: { ...message, stopReason: "aborted", errorMessage: "Request was aborted" },
      });

      return;
    }

    const stopReason = message.content.some((block) => block.type === "toolCall")
      ? "toolUse"
      : "stop";

    stream.push({ type: "done", reason: stopReason, message: { ...message, stopReason } });
  })();

  return stream;
}
