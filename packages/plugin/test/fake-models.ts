import type { SimpleStreamOptions } from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import type { MutableModels } from "@nyte-ai/ai/models";
import { AssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import { memoryStore } from "@nyte-ai/core";
import type {
  BrowserApi,
  ComposeOptions,
  ExecutionEnv,
  Kernel,
  Plugin,
  ServedHost,
  Store,
} from "@nyte-ai/core";
import { asId } from "@nyte-ai/schema";
import { composeServer } from "../../core/src/compose.ts";
import type { Api, AssistantMessage, Model, TranscriptContext } from "@nyte-ai/schema/model";

export type Block =
  | { readonly type: "text"; readonly text: string }
  | {
      readonly type: "toolCall";
      readonly id: string;
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    };

export interface Reply {
  readonly content?: readonly Block[];
  readonly error?: string;
}

export interface Request {
  readonly model: Model<Api>;
  readonly context: TranscriptContext;
  readonly options: SimpleStreamOptions | undefined;
}

export interface FakeModels {
  readonly models: MutableModels;
  readonly requests: Request[];
  reply(...replies: readonly Reply[]): void;
}

export function testModel(id: string, overrides?: Partial<Model<Api>>): Model<Api> {
  return {
    id,
    name: id,
    api: "test-api",
    provider: "test",
    baseUrl: "https://example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 4_096,
    ...overrides,
  };
}

export function fakeModels(models?: readonly Model<Api>[], provider = "test"): FakeModels {
  const queue: Reply[] = [];
  const requests: Request[] = [];
  const registry = createModels();

  const respond = (
    model: Model<Api>,
    context: TranscriptContext,
    options?: SimpleStreamOptions,
  ) => {
    requests.push({ model, context, options });

    return streamOf(model, queue.shift() ?? { error: "No reply was scripted for this request." });
  };

  registry.setProvider({
    id: provider,
    name: provider,
    auth: {
      apiKey: {
        name: "Test key",
        resolve: async () => ({ auth: { apiKey: "key" }, source: "test" }),
      },
    },
    getModels: () => models ?? [testModel("model")],
    stream: (model, context) => respond(model, context),
    streamSimple: respond,
  });

  return { models: registry, requests, reply: (...replies) => queue.push(...replies) };
}

export const env: ExecutionEnv = {
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

/** Composes a host as `composeHost` does, with its kernel beside it, for tests that read kernel state. */
async function composed(
  options: ComposeOptions,
): Promise<ServedHost & { readonly kernel: Kernel }> {
  const { host, kernel } = await composeServer(options);

  return { ...host, kernel };
}

export function open(
  fake: FakeModels,
  plugins: readonly Plugin<"core">[],
  options?: {
    readonly browser?: BrowserApi;
    readonly store?: Store;
    readonly execution?: ComposeOptions["execution"];
    readonly poll?: number;
  },
): Promise<ServedHost & { readonly kernel: Kernel }> {
  const browser = options?.browser;

  return composed({
    store: options?.store ?? memoryStore(),
    execution: options?.execution,
    poll: options?.poll,
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
          ...(browser === undefined ? {} : { browser: () => browser }),
        },
      },
      ...plugins,
    ],
    workspace: { kind: "chat-only", locator: null },
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });
}

export async function until<T>(
  read: () => Promise<T | undefined> | T | undefined,
  timeout = 3000,
): Promise<T> {
  const deadline = Date.now() + timeout;

  for (;;) {
    const value = await read();

    if (value !== undefined) return value;

    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function streamOf(model: Model<Api>, reply: Reply): AssistantMessageEventStream {
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

      message.content.push({ type: "text", text: block.text });
      stream.push({ type: "text_start", contentIndex: index, partial: message });
      stream.push({ type: "text_delta", contentIndex: index, delta: block.text, partial: message });
      stream.push({ type: "text_end", contentIndex: index, content: block.text, partial: message });
    }

    if (reply.error !== undefined) {
      stream.push({
        type: "error",
        reason: "error",
        error: { ...message, stopReason: "error", errorMessage: reply.error },
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

async function refuse(): Promise<never> {
  throw new Error("No environment in tests.");
}

function refuseStream(): AsyncIterable<never> {
  return { [Symbol.asyncIterator]: () => ({ next: refuse }) };
}
