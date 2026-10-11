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
import type { HostView, ModelRef } from "@nyte-ai/schema";
import type {
  Api,
  AssistantMessage,
  Model,
  StopReason,
  TextContent,
  ThinkingContent,
  TranscriptContext,
} from "@nyte-ai/schema/model";
import { composeHost, memoryStore } from "@nyte-ai/core";
import type { ComposeOptions, ExecutionEnv, Plugin, Store } from "@nyte-ai/core";

/** One content block a scripted reply streams. */
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

/** One scripted provider answer: what it streams, what it reports, and how it ends. */
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
  /** Ends the stream with this provider error, cutting its last block short (no `*_end`). */
  readonly error?: string;
  /** Holds the stream after its first delta until the request's signal aborts. */
  readonly hold?: boolean;
  /** Stalls the stream after its first delta for good, deaf to the request's signal. */
  readonly stall?: boolean;
  /** Holds the stream's end until this settles. */
  readonly until?: Promise<void>;
  /** Account windows reported on the response. */
  readonly limits?: readonly AccountLimitWindow[];
  /** Streams each text block in this many deltas, as even as the text allows, instead of two halves. */
  readonly tokens?: number;
  /** Called after each text delta with the count of text deltas this response has streamed so far; the stream waits for what it returns before the next event. */
  readonly tap?: (streamed: number) => Promise<void> | void;
}

/** One request the fake provider received. */
export interface Request {
  readonly model: Model<Api>;
  readonly context: TranscriptContext;
  readonly options: SimpleStreamOptions | undefined;
}

/** A scripted provider inside a real `Models`: replies answered in order, every request recorded, and its auth state. */
export interface FakeModels {
  readonly models: MutableModels;
  readonly provider: Provider;
  readonly requests: Request[];
  /** Queues replies; a function sees the request it answers. */
  reply(...replies: readonly (Reply | ((request: Request) => Reply))[]): void;
  /** Whether the provider's api key resolves; default true. */
  configured: boolean;
  /** What the provider's verify request answers; null makes it throw, as an unreachable provider does. */
  verdict: ProviderAuthVerification | null;
}

/** Returns a catalog model of the fake provider. */
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

/** Returns a `Models` holding one scripted provider `test` (unless `id` names another; added to `into` when given) with `models` (default one model `model`), api-key and oauth logins, and, unless `verify` is false, a verify request answering `verdict`. A request with no reply queued answers `fallback`, else the provider error "No reply was scripted for this request.". */
export function fakeModels(input?: {
  readonly id?: string;
  readonly name?: string;
  readonly models?: readonly Model<Api>[];
  readonly into?: MutableModels;
  readonly verify?: boolean;
  readonly fallback?: Reply;
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
        ? (input?.fallback ?? { error: "No reply was scripted for this request." })
        : typeof next === "function"
          ? next(request)
          : next;

    return streamOf(model, reply, options);
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

/** One scripted model response the bench asks for: `text` streamed in `tokens` pieces, then the `tools` calls, then, on the request after their results, `after` (the bench's `ScriptedTurn`). */
export interface ScriptedTurn {
  readonly text: string;
  readonly tokens: number;
  readonly tools?: readonly { readonly name: string; readonly args: Record<string, unknown> }[];
  readonly after?: string;
}

/** The bench's model (`FakeModel` in `packages/bench/src/driver.ts`): a ref to pick it, a script of the next responses, and a pause in the middle of one. */
export interface FakeModel {
  /** The model the bench host uses by default. */
  readonly ref: ModelRef;
  /** The next request answers with this turn. Unscripted requests answer with one short text. */
  script(turn: ScriptedTurn): void;
  /** Resolves when the model has emitted `count` tokens of the current response; the response then pauses until `release()`. */
  pauseAfter(count: number): Promise<void>;
  /** Lets a paused response go on. */
  release(): void;
}

/** Returns the bench's `FakeModel` over `fake`, which the bench makes with a `fallback` of one short text (what an unscripted request answers): `ref` the provider's first model; `script(turn)` queues one reply streaming `turn.text` in `turn.tokens` deltas (no text block when the text is empty) followed by a `toolCall` block per `turn.tools` entry (ids `bench-<n>`, counted across the model's life), and, when `turn.tools` is non-empty and `turn.after` is set, a second reply streaming `after` as one text block for the request that carries their results. Every scripted reply taps its stream: `pauseAfter(count)` arms one gate, and the first response to stream a text delta at or past `count` (one streaming already, or a later one; with two streaming, whichever gets there first) holds after that delta, resolves the promise, and stays held until `release()`; `release()` with no response held does nothing. */
export function scriptedModel(fake: FakeModels): FakeModel {
  const [first] = fake.provider.getModels();

  if (first === undefined) throw new Error("The bench provider has no model.");
  let calls = 0;
  let gate: { readonly count: number; readonly reached: PromiseWithResolvers<void> } | null = null;
  let held: PromiseWithResolvers<void> | null = null;

  const tap = async (streamed: number): Promise<void> => {
    if (gate === null || streamed < gate.count) return;
    const armed = gate;
    gate = null;
    const hold = Promise.withResolvers<void>();
    held = hold;
    armed.reached.resolve();
    await hold.promise;
  };

  return {
    ref: { provider: fake.provider.id, id: first.id },
    script(turn) {
      const tools = (turn.tools ?? []).map((tool): Block => {
        calls += 1;

        return { type: "toolCall", id: `bench-${calls}`, name: tool.name, arguments: tool.args };
      });

      const text: readonly Block[] = turn.text === "" ? [] : [{ type: "text", text: turn.text }];
      fake.reply({ content: [...text, ...tools], tokens: turn.tokens, tap });

      if (tools.length > 0 && turn.after !== undefined)
        fake.reply({ content: [{ type: "text", text: turn.after }], tap });
    },
    pauseAfter(count) {
      const reached = Promise.withResolvers<void>();
      gate = { count, reached };

      return reached.promise;
    },
    release() {
      const hold = held;
      held = null;
      hold?.resolve();
    },
  };
}

/** An environment whose files and processes refuse: enough for a chat. */
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

/** An environment provider of kind `chat-only` whose files and processes refuse: the workspace a chat needs. */
export const chatOnly: Plugin<"core"> = {
  id: "chat-only",
  environment: {
    kind: "chat-only",
    inspect: async () => ({
      identity: asId("chat-only"),
      availability: { kind: "available" },
      projectSources: [],
    }),
    attach: async () => env,
  },
};

/** Composes a host over a memory store (or `store`) with the fake models, the chat-only environment, `plugins` and the plugin file loader `loadPlugins`. */
export async function open(
  fake: FakeModels,
  options?: {
    readonly plugins?: readonly Plugin<"core">[];
    readonly store?: Store;
    readonly operations?: HostView["operations"];
    readonly execution?: ComposeOptions["execution"];
    readonly loadPlugins?: ComposeOptions["loadPlugins"];
  },
): ReturnType<typeof composeHost> {
  return composeHost({
    store: options?.store ?? memoryStore(),
    models: fake.models,
    plugins: [chatOnly, ...(options?.plugins ?? [])],
    workspace: { kind: "chat-only", locator: null },
    execution: options?.execution,
    loadPlugins: options?.loadPlugins,
    home: null,
    operations: options?.operations ?? [],
    description: { name: "test", platform: "darwin", version: "0.1.0" },
  });
}

/** Returns a stream that plays a reply as provider events, honouring the request's abort signal. */
function streamOf(
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
    let streamed = 0;
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

        const deltas =
          reply.tokens === undefined
            ? [body.slice(0, half), body.slice(half)]
            : piecesOf(body, reply.tokens);

        for (const delta of deltas) {
          content.text += delta;
          stream.push({ type: "text_delta", contentIndex: index, delta, partial: message });
          streamed += 1;
          await reply.tap?.(streamed);

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

/** Splits a text into `count` consecutive pieces as even as its length allows (at least one). */
function piecesOf(text: string, count: number): readonly string[] {
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
