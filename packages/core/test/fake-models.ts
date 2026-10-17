import type {
  AccountLimitWindow,
  ProviderAuth,
  ProviderAuthVerification,
  SimpleStreamOptions,
} from "@nyte-ai/ai";
import { createModels } from "@nyte-ai/ai/models";
import type { MutableModels, Provider } from "@nyte-ai/ai/models";
import { AssistantMessageEventStream } from "@nyte-ai/ai/utils/event-stream";
import { asId } from "@nyte-ai/schema";
import type {
  Api,
  AssistantMessage,
  Model,
  StopReason,
  TextContent,
  ThinkingContent,
  TranscriptContext,
} from "@nyte-ai/schema/model";
import { composeServer } from "../src/compose.ts";
import { memoryStore } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { Plugin, Store } from "../src/index.ts";
import type { ComposeOptions, ServedHost } from "../src/server.ts";
import { env } from "../src/harness.ts";

export type Block =
  | { readonly type: "text"; readonly text: string; readonly signature?: string }
  | {
      readonly type: "thinking";
      readonly thinking: string;
      readonly signature?: string;
      readonly redacted?: boolean;
    }
  | {
      readonly type: "toolCall";
      readonly id: string;
      readonly name: string;
      readonly arguments: Record<string, unknown>;
    };

export interface Reply {
  readonly content?: readonly Block[];
  readonly usage?: Partial<{
    readonly input: number;
    readonly output: number;
    readonly cacheRead: number;
    readonly cacheWrite: number;
    readonly reasoning: number;
    readonly cost: number;
  }>;
  readonly stopReason?: Extract<StopReason, "stop" | "length" | "toolUse">;
  readonly rawStopReason?: string;
  readonly error?: string;
  readonly hold?: boolean;
  readonly stall?: boolean;
  readonly until?: Promise<void>;
  readonly limits?: readonly AccountLimitWindow[];
}

export interface Request {
  readonly model: Model<Api>;
  readonly context: TranscriptContext;
  readonly options: SimpleStreamOptions | undefined;
}

export interface FakeModels {
  readonly models: MutableModels;
  readonly provider: Provider;
  readonly requests: Request[];
  reply(...replies: readonly (Reply | ((request: Request) => Reply))[]): void;
  configured: boolean;
  verdict: ProviderAuthVerification | null;
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

export function fakeModels(input?: {
  readonly id?: string;
  readonly name?: string;
  readonly models?: readonly Model<Api>[];
  readonly into?: MutableModels;
  readonly verify?: boolean;
}): FakeModels {
  const id = input?.id ?? "test";
  const catalog = input?.models ?? [testModel("model", { provider: id })];
  const queue: (Reply | ((request: Request) => Reply))[] = [];
  const requests: Request[] = [];

  const auth: ProviderAuth = {
    apiKey: {
      name: "Test key",
      resolve: async () =>
        fake.configured ? { auth: { apiKey: "key" }, source: "test" } : undefined,
      async login(interaction) {
        const key = await interaction.prompt({ type: "secret", message: "Paste your key." });
        fake.configured = true;

        return { type: "api_key", key };
      },
    },
    oauth: {
      name: "Test account",
      async login(interaction) {
        interaction.notify({
          type: "device_code",
          userCode: "ABCD-1234",
          verificationUri: "https://example.test/device",
        });

        const organisation = await interaction.prompt({
          type: "select",
          message: "Pick an organisation.",
          options: [
            { id: "one", label: "One" },
            { id: "two", label: "Two" },
          ],
        });

        interaction.notify({ type: "progress", message: "Signing in." });

        if (organisation === "two") throw new Error("Organisation two has no access.");
        fake.configured = true;

        return {
          type: "oauth",
          access: "access",
          refresh: "refresh",
          expires: Date.now() + 60_000,
        };
      },
      refresh: async (credential) => credential,
      toAuth: async (credential) => ({ apiKey: credential.access }),
    },
    verify:
      input?.verify === false
        ? undefined
        : async () => {
            if (fake.verdict === null) throw new Error("The provider cannot be reached.");

            return fake.verdict;
          },
  };

  const respond = (
    model: Model<Api>,
    context: TranscriptContext,
    options: SimpleStreamOptions | undefined,
  ): AssistantMessageEventStream => {
    const request: Request = { model, context, options };
    requests.push(request);
    const next = queue.shift();

    const reply: Reply =
      next === undefined
        ? { error: "No reply was scripted for this request." }
        : typeof next === "function"
          ? next(request)
          : next;

    return streamReply(model, reply, options);
  };

  const provider: Provider = {
    id,
    name: input?.name ?? id,
    auth,
    getModels: () => catalog,
    stream: (model, context) => respond(model, context, undefined),
    streamSimple: (model, context, options) => respond(model, context, options),
  };

  const models = input?.into ?? createModels();
  models.setProvider(provider);

  const fake: FakeModels = {
    models,
    provider,
    requests,
    reply: (...replies) => queue.push(...replies),
    configured: true,
    verdict: { ok: true },
  };

  return fake;
}

export const chatOnly: Plugin<"core"> = {
  id: "chat-only",
  environment: {
    kind: "chat-only",
    inspect: async () => ({
      identity: asId("chat-only"),
      availability: { kind: "available" },
      projectSources: [],
    }),
    attach: async () => ({ ...env, identity: asId("chat-only") }),
  },
};

/** A composed host with the kernel under it, for tests that read kernel state. */
export type Composed = ServedHost & { readonly kernel: Kernel };

/** Composes a host as `composeHost` does, with its kernel beside it. */
export async function composed(options: ComposeOptions): Promise<Composed> {
  const { host, kernel } = await composeServer(options);

  return { ...host, kernel };
}

export async function open(
  fake: FakeModels,
  options?: {
    readonly plugins?: readonly Plugin<"core">[];
    readonly store?: Store;
    readonly execution?: ComposeOptions["execution"];
  },
): Promise<Composed> {
  return composed({
    store: options?.store ?? memoryStore(),
    models: fake.models,
    plugins: [chatOnly, ...(options?.plugins ?? [])],
    workspace: { kind: "chat-only", locator: null },
    execution: options?.execution,
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });
}

function streamReply(
  model: Model<Api>,
  reply: Reply,
  options: SimpleStreamOptions | undefined,
): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const signal = options?.signal;
  const counts = reply.usage ?? {};
  const input = counts.input ?? 10;
  const output = counts.output ?? 5;
  const cacheRead = counts.cacheRead ?? 0;
  const cacheWrite = counts.cacheWrite ?? 0;

  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input,
      output,
      cacheRead,
      cacheWrite,
      ...(counts.reasoning === undefined ? {} : { reasoning: counts.reasoning }),
      totalTokens: input + output + cacheRead + cacheWrite,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: counts.cost ?? 0 },
    },
    stopReason: "stop",
    ...(reply.rawStopReason === undefined ? {} : { rawStopReason: reply.rawStopReason }),
    timestamp: Date.now(),
  };

  const aborted = (): boolean => {
    if (signal?.aborted !== true) return false;
    stream.push({
      type: "error",
      reason: "aborted",
      error: { ...message, stopReason: "aborted", errorMessage: "Request was aborted" },
    });

    return true;
  };

  const held = (): Promise<void> =>
    new Promise((resolve) => {
      if (signal === undefined || signal.aborted) {
        resolve();

        return;
      }

      signal.addEventListener("abort", () => resolve(), { once: true });
    });

  void (async () => {
    await Promise.resolve();
    stream.push({ type: "start", partial: message });

    if (reply.limits !== undefined)
      await options?.onAccountLimits?.(
        { providerId: model.provider, windows: reply.limits, observedAt: Date.now() },
        model,
      );

    for (const [index, block] of (reply.content ?? []).entries()) {
      if (aborted()) return;

      if (block.type === "toolCall") {
        message.content.push({
          type: "toolCall",
          id: block.id,
          name: block.name,
          arguments: block.arguments,
        });
        stream.push({ type: "toolcall_start", contentIndex: index, partial: message });
        stream.push({
          type: "toolcall_end",
          contentIndex: index,
          toolCall: {
            type: "toolCall",
            id: block.id,
            name: block.name,
            arguments: block.arguments,
          },
          partial: message,
        });
        continue;
      }

      const body = block.type === "text" ? block.text : block.thinking;
      const half = Math.ceil(body.length / 2);

      if (block.type === "text") {
        const content: TextContent = { type: "text", text: "" };
        message.content.push(content);
        stream.push({ type: "text_start", contentIndex: index, partial: message });

        for (const delta of [body.slice(0, half), body.slice(half)]) {
          content.text += delta;
          stream.push({ type: "text_delta", contentIndex: index, delta, partial: message });

          if (reply.hold === true) await held();

          if (reply.stall === true) await new Promise<never>(() => undefined);

          if (aborted()) return;
        }

        if (block.signature !== undefined) content.textSignature = block.signature;

        if (reply.error === undefined || index < (reply.content ?? []).length - 1)
          stream.push({ type: "text_end", contentIndex: index, content: body, partial: message });
        continue;
      }

      const content: ThinkingContent = { type: "thinking", thinking: "" };
      message.content.push(content);
      stream.push({ type: "thinking_start", contentIndex: index, partial: message });

      for (const delta of [body.slice(0, half), body.slice(half)]) {
        content.thinking += delta;
        stream.push({ type: "thinking_delta", contentIndex: index, delta, partial: message });
      }

      if (block.signature !== undefined) content.thinkingSignature = block.signature;

      if (block.redacted === true) content.redacted = true;
      stream.push({ type: "thinking_end", contentIndex: index, content: body, partial: message });
    }

    await reply.until;

    if (aborted()) return;

    if (reply.error !== undefined) {
      stream.push({
        type: "error",
        reason: "error",
        error: { ...message, stopReason: "error", errorMessage: reply.error },
      });

      return;
    }

    const stopReason =
      reply.stopReason ??
      (message.content.some((block) => block.type === "toolCall") ? "toolUse" : "stop");

    stream.push({ type: "done", reason: stopReason, message: { ...message, stopReason } });
  })();

  return stream;
}
