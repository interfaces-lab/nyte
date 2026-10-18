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
  ToolCall,
  TranscriptContext,
} from "@nyte-ai/schema/model";
import { composeHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import type { ExecutionEnv, Plugin, Store } from "@nyte-ai/core";
import type { ComposeOptions } from "@nyte-ai/core/server";
import { TITLE_PROMPT } from "@nyte-ai/plugin/core/rename";

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
      readonly deltas?: number;
    };

export interface Clock {
  now(): number;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise((resolve) => {
      if (ms <= 0 || signal?.aborted === true) {
        resolve();

        return;
      }

      const timer = setTimeout(resolve, ms);

      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    }),
};

export interface ManualClock extends Clock {
  advance(ms: number): Promise<void>;
}

export function manualClock(start = 0): ManualClock {
  let now = start;
  const sleeping: { readonly due: number; readonly wake: () => void }[] = [];

  return {
    now: () => now,
    sleep: (ms, signal) =>
      new Promise((resolve) => {
        if (ms <= 0 || signal?.aborted === true) {
          resolve();

          return;
        }

        sleeping.push({ due: now + ms, wake: resolve });
        signal?.addEventListener("abort", () => resolve(), { once: true });
      }),
    async advance(ms) {
      const until = now + ms;

      for (;;) {
        sleeping.sort((a, b) => a.due - b.due);
        const next = sleeping[0];

        if (next === undefined || next.due > until) break;
        sleeping.shift();
        now = next.due;
        next.wake();
        await new Promise<void>((resolve) => setImmediate(resolve));
      }

      now = until;
    },
  };
}

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
  readonly tokens?: number;
  readonly tap?: (streamed: number) => Promise<void> | void;
  readonly timing?: { readonly firstMs?: number; readonly deltaMs?: number };
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

export function lastUserText(request: Request): string {
  const message = request.context.messages.findLast((candidate) => candidate.role === "user");

  if (message?.role !== "user") return "";

  return typeof message.content === "string"
    ? message.content
    : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

export function titleReply(request: Request): string | null {
  const first = request.context.messages[0];

  if (first?.role !== "system" || first.content !== TITLE_PROMPT) return null;

  return (lastUserText(request).split("\n")[0] ?? "").replace(/^User: /u, "");
}

export function fakeModels(input?: {
  readonly id?: string;
  readonly name?: string;
  readonly models?: readonly Model<Api>[];
  readonly into?: MutableModels;
  readonly verify?: boolean;
  readonly fallback?: Reply | ((request: Request) => Reply);
  readonly clock?: Clock;
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
    const next = queue.shift() ??
      input?.fallback ?? { error: "No reply was scripted for this request." };

    const reply: Reply = typeof next === "function" ? next(request) : next;

    return streamReply(model, reply, options, input?.clock ?? realClock);
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

const env: ExecutionEnv = {
  identity: asId("chat-only"),
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

export const chatOnly: Plugin<"core"> = {
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
};

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
  model: Model<Api>,
  reply: Reply,
  options: SimpleStreamOptions | undefined,
  clock: Clock,
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
    timestamp: clock.now(),
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

  const paced = (): Promise<void> => clock.sleep(reply.timing?.deltaMs ?? 0, signal);

  void (async () => {
    let streamed = 0;
    await Promise.resolve();
    await clock.sleep(reply.timing?.firstMs ?? 0, signal);

    if (aborted()) return;
    stream.push({ type: "start", partial: message });

    if (reply.limits !== undefined)
      await options?.onAccountLimits?.(
        { providerId: model.provider, windows: reply.limits, observedAt: clock.now() },
        model,
      );

    for (const [index, block] of (reply.content ?? []).entries()) {
      if (aborted()) return;

      if (block.type === "toolCall") {
        const call: ToolCall = {
          type: "toolCall",
          id: block.id,
          name: block.name,
          arguments: block.deltas === undefined ? block.arguments : {},
        };

        message.content.push(call);
        stream.push({ type: "toolcall_start", contentIndex: index, partial: message });

        const deltas =
          block.deltas === undefined
            ? []
            : splitText(JSON.stringify(block.arguments), block.deltas);

        for (const delta of deltas) {
          stream.push({ type: "toolcall_delta", contentIndex: index, delta, partial: message });
          await paced();

          if (aborted()) return;
        }

        call.arguments = block.arguments;
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

        const deltas =
          reply.tokens === undefined
            ? [body.slice(0, half), body.slice(half)]
            : splitText(body, reply.tokens);

        for (const delta of deltas) {
          content.text += delta;
          stream.push({ type: "text_delta", contentIndex: index, delta, partial: message });
          streamed += 1;
          await reply.tap?.(streamed);
          await paced();

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
        await paced();
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

function splitText(text: string, count: number): readonly string[] {
  const pieces = Math.max(1, count);

  return Array.from({ length: pieces }, (_, index) =>
    text.slice(
      Math.floor((index * text.length) / pieces),
      Math.floor(((index + 1) * text.length) / pieces),
    ),
  );
}

async function refuse(): Promise<never> {
  throw new Error("No environment in tests.");
}

function refuseStream(): AsyncIterable<never> {
  return { [Symbol.asyncIterator]: () => ({ next: refuse }) };
}
