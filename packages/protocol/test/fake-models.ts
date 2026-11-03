import type { SimpleStreamOptions } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import type { MutableModels } from "@nyte-ai/ai/models";
import { AssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import type { ExecutionEnv, Plugin } from "@nyte-ai/core";
import type { ServedHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import { composeServer } from "@nyte-ai/core/testing";
import type { Kernel } from "@nyte-ai/core/testing";
import { asId } from "@nyte-ai/schema";
import type { Api, AssistantMessage, Model, TranscriptContext } from "@nyte-ai/schema/model";

export type Block =
  | { readonly type: "text"; readonly text: string; readonly signature?: string }
  | { readonly type: "thinking"; readonly thinking: string; readonly signature?: string }
  | {
      readonly type: "toolCall";
      readonly id: string;
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    };

export interface Reply {
  readonly content?: readonly Block[];
  readonly hold?: boolean;
}

export interface FakeModels {
  readonly models: MutableModels;
  reply(...replies: readonly Reply[]): void;
}

export type Composed = ServedHost & { readonly kernel: Kernel };

export function fakeModels(): FakeModels {
  const queue: Reply[] = [];
  const registry = createModels();

  const respond = (model: Model<Api>, _context: TranscriptContext, options?: SimpleStreamOptions) =>
    streamReply(
      model,
      queue.shift() ?? { content: [{ type: "text", text: "Unscripted." }] },
      options,
    );

  registry.setProvider({
    id: "test",
    name: "test",
    auth: {
      apiKey: {
        name: "Test key",
        resolve: async () => ({ auth: { apiKey: "key" }, source: "test" }),
      },
    },
    getModels: () => [
      {
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
      },
    ],
    stream: (model, context) => respond(model, context),
    streamSimple: respond,
  });

  return { models: registry, reply: (...replies) => queue.push(...replies) };
}

const env: ExecutionEnv = {
  identity: asId("identity"),
  cwd: "/tmp/project",
  files: {
    read: refuse,
    bytes: refuse,
    stat: refuse,
    write: refuse,
    remove: refuse,
    batch: () => {
      throw new Error("No files in tests.");
    },
    format: refuse,
    scan: refuseStream,
    find: refuse,
    search: refuseStream,
    watch: refuseStream,
    upload: refuse,
  },
  exec: refuse,
  close: async () => undefined,
};

export async function open(
  fake: FakeModels,
  plugins: readonly Plugin<"core">[],
): Promise<Composed> {
  const composed = await composeServer({
    store: memoryStore(),
    models: fake.models,
    plugins: [
      {
        id: "chat-only",
        environment: {
          kind: "chat-only",
          inspect: async () => ({
            identity: env.identity,
            availability: { kind: "available" },
            projectSources: [],
          }),
          attach: async () => env,
        },
      },
      ...plugins,
    ],
    workspace: { kind: "chat-only", locator: null },
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });

  return { ...composed.host, kernel: composed.kernel };
}

export async function until<T>(read: () => Promise<T | undefined> | T | undefined): Promise<T> {
  const deadline = Date.now() + 3000;

  for (;;) {
    const value = await read();

    if (value !== undefined) return value;

    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition.");
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function streamReply(
  model: Model<Api>,
  reply: Reply,
  options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const signal = options?.signal;

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
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };

  void (async () => {
    await Promise.resolve();
    stream.push({ type: "start", partial: message });

    for (const [index, block] of (reply.content ?? []).entries()) {
      if (block.type === "toolCall") {
        const call = {
          type: "toolCall",
          id: block.id,
          name: block.name,
          arguments: block.arguments,
        } as const;

        message.content.push(call);
        stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
        stream.push({
          type: "toolcall_end",
          contentIndex: index,
          toolCall: call,
          partial: message,
        });
        continue;
      }

      if (block.type === "thinking") {
        message.content.push({
          type: "thinking",
          thinking: block.thinking,
          ...(block.signature === undefined ? {} : { thinkingSignature: block.signature }),
        });
        stream.push({ type: "thinking_start", contentIndex: index, partial: message });
        stream.push({
          type: "thinking_delta",
          contentIndex: index,
          delta: block.thinking,
          partial: message,
        });
        stream.push({
          type: "thinking_end",
          contentIndex: index,
          content: block.thinking,
          partial: message,
        });
        continue;
      }

      message.content.push({
        type: "text",
        text: block.text,
        ...(block.signature === undefined ? {} : { textSignature: block.signature }),
      });
      stream.push({ type: "text_start", contentIndex: index, partial: message });
      stream.push({ type: "text_delta", contentIndex: index, delta: block.text, partial: message });

      if (reply.hold === true) {
        await aborted(signal);
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...message, stopReason: "aborted", errorMessage: "Request was aborted" },
        });

        return;
      }

      stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: message });
    }

    const stopReason = message.content.some((block) => block.type === "toolCall")
      ? "toolUse"
      : "stop";

    stream.push({ type: "done", reason: stopReason, message: { ...message, stopReason } });
  })();

  return stream;
}

function aborted(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve) => {
    if (signal === undefined || signal.aborted) {
      resolve();

      return;
    }

    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

async function refuse(): Promise<never> {
  throw new Error("No environment in tests.");
}

function refuseStream(): AsyncIterable<never> {
  return { [Symbol.asyncIterator]: () => ({ next: refuse }) };
}
