/**
 * The host these tests run their plugins in.
 *
 * `@nyte-ai/plugin` re-exports `@nyte-ai/core/plugins` and nothing else, so its
 * tests reach core the way any host does: `createNyte` for the operations and a
 * `SqliteStore` from `/store` for durability. Nothing here reaches a kernel
 * internal, which is the point: a plugin that only works when the test drives
 * the loop directly is a plugin no host can load.
 *
 * Every plugin fact these tests care about is read back through the operations a
 * client has (`plugins.settings.list`, `plugins.commands.run`, the transcript,
 * the event stream). The one exception is what a tool returned: the transcript
 * carries a call's class and output, and the `ToolResultMessage` itself lives on
 * the tool-result commit, so `toolResultOf` reads that commit from the store.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, type AssistantMessageEventStream } from "@nyte-ai/ai";
import { createNyte } from "@nyte-ai/core";
import type {
  CompactionSettings,
  LoadedPlugin,
  ModelCatalog,
  Nyte,
  SessionEvent,
  SessionId,
  StaticNyteOptions,
  StreamFn,
  WaitOutcome,
} from "@nyte-ai/core";
import type { ToolTurnPart } from "@nyte-ai/protocol";
import { branch, SqliteStore, type Store } from "@nyte-ai/core/store";
import type { Api, AssistantMessage, Model, ToolCall, ToolResultMessage } from "@nyte-ai/schema";

/** A model that advertises nothing special; tests spread over it for what they need. */
export const testModel: Model<Api> = {
  id: "test-model",
  name: "Test model",
  api: "openai-responses",
  provider: "test",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

/** A catalog over a fixed set of models: composition never reaches a network. */
export function catalogOf(...models: readonly Model<Api>[]): ModelCatalog {
  const getModels = (provider?: string) =>
    provider === undefined ? models : models.filter((m) => m.provider === provider);
  return {
    getModels,
    getModel: (provider, id) =>
      models.find((m) => m.provider === provider && m.id === id) ?? models.find((m) => m.id === id),
    getAvailable: async (provider) => getModels(provider),
  };
}

/** One assistant message the way a provider would settle it, for a scripted `StreamFn`. */
export function respond(
  model: Model<Api>,
  content: AssistantMessage["content"],
): AssistantMessageEventStream {
  const reason = content.some((part) => part.type === "toolCall") ? "toolUse" : "stop";
  const message: AssistantMessage = {
    role: "assistant",
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: reason,
    timestamp: Date.now(),
  };
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => stream.push({ type: "done", reason, message }));
  return stream;
}

export function toolCall(id: string, name: string, args: ToolCall["arguments"]): ToolCall {
  return { type: "toolCall", id, name, arguments: args };
}

export interface OpenOptions {
  readonly streamFn: StreamFn;
  readonly plugins: readonly LoadedPlugin[];
  readonly model: Model<Api>;
  readonly models?: readonly Model<Api>[];
  readonly compaction?: CompactionSettings;
}

/**
 * One workspace, one store, one session, reopened as many times as a test
 * needs. Sessions outlive a `Nyte`, so a test proving a plugin's selection
 * survives a restart composes a second `Nyte` over the same store and
 * targets the same session id.
 */
export class TestWorkspace {
  readonly directory: string;
  readonly store: SqliteStore;
  private sessionIdValue: SessionId | undefined;
  private readonly opened: Nyte[] = [];

  private constructor(directory: string) {
    this.directory = directory;
    this.store = new SqliteStore(join(directory, "sessions.db"), { watchPollIntervalMs: 5 });
  }

  static create(prefix: string): TestWorkspace {
    return new TestWorkspace(mkdtempSync(join(tmpdir(), prefix)));
  }

  /** The session every `open` in this workspace targets. */
  get sessionId(): SessionId {
    if (this.sessionIdValue === undefined) throw new Error("open the workspace first");
    return this.sessionIdValue;
  }

  async open(options: OpenOptions): Promise<Nyte> {
    const base: StaticNyteOptions = {
      store: this.store,
      streamFn: options.streamFn,
      models: catalogOf(...(options.models ?? [options.model])),
      model: options.model,
      plugins: options.plugins,
      env: { cwd: this.directory },
    };
    const sdk = await createNyte(
      options.compaction === undefined ? base : { ...base, compaction: options.compaction },
    );
    this.opened.push(sdk);
    storeOf.set(sdk, this.store);
    this.sessionIdValue ??= (await sdk.sessions.create()).sessionId;
    sdk.attach();
    return sdk;
  }

  async close(): Promise<void> {
    for (const sdk of this.opened.splice(0)) await sdk.close().catch(() => undefined);
    await this.store.close().catch(() => undefined);
    rmSync(this.directory, { recursive: true, force: true });
  }
}

const storeOf = new WeakMap<Nyte, Store>();

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `runs.wait` answers `idle` once the run's phase is terminal, which is a
 * moment before its runner releases the head lease. An operation that needs the
 * head free (`runs.compact`) would answer `busy` in that gap, so wait for the
 * release too, through the same public read a client has.
 */
async function untilReleased(sdk: Nyte, sessionId: SessionId): Promise<void> {
  const deadline = Date.now() + 2_000;
  while ((await sdk.runs.current({ sessionId }))?.lease !== undefined) {
    if (Date.now() > deadline) throw new Error("the runner never released the head");
    await sleep(5);
  }
}

/** Send a prompt and wait for the run it wakes to settle or park. */
export async function prompt(sdk: Nyte, sessionId: SessionId, text: string): Promise<WaitOutcome> {
  await sdk.messages.send({ sessionId, content: [{ type: "text", text }] });
  const outcome = await sdk.runs.wait({ sessionId });
  if (outcome.kind === "idle") await untilReleased(sdk, sessionId);
  return outcome;
}

/** A setting's current choice, or undefined when no plugin contributed it. */
export async function settingOf(
  sdk: Nyte,
  sessionId: SessionId,
  id: string,
): Promise<string | undefined> {
  return (await sdk.plugins.settings.list({ sessionId })).find((s) => s.id === id)?.current;
}

/** A command's output, asserting it ran. */
export async function runCommand(
  sdk: Nyte,
  sessionId: SessionId,
  name: string,
  argument?: string,
): Promise<string | undefined> {
  const outcome = await sdk.plugins.commands.run(
    argument === undefined ? { sessionId, name } : { sessionId, name, argument },
  );
  if (outcome.kind !== "ran") throw new Error(`command ${name}: ${outcome.kind}`);
  return outcome.output;
}

/** Every tool call on the branch, with its result where one has landed. */
export async function toolParts(sdk: Nyte, sessionId: SessionId): Promise<ToolTurnPart[]> {
  const turns = await sdk.messages.list({ sessionId });
  return turns.flatMap((turn) =>
    turn.kind === "turn" ? turn.parts.filter((part) => part.kind === "tool") : [],
  );
}

/** The message a tool returned for a call, read from the tool-result commit on `main`. */
export async function toolResultOf(input: {
  readonly sdk: Nyte;
  readonly sessionId: SessionId;
  readonly callId: string;
}): Promise<ToolResultMessage> {
  const store = storeOf.get(input.sdk);
  if (store === undefined) throw new Error("open the sdk through a TestWorkspace");
  const session = await store.open(input.sessionId);
  try {
    const commits = await branch(session.objects, await session.refs.read("refs/heads/main"));
    for (const { commit } of commits) {
      if (commit.body.kind !== "message") continue;
      const { message } = commit.body;
      if (message.role === "toolResult" && message.toolCallId === input.callId) return message;
    }
  } finally {
    await session.close();
  }
  throw new Error(`call ${input.callId} has no tool result on main`);
}

/** The text of the last assistant message on the branch. */
export async function lastAssistantText(sdk: Nyte, sessionId: SessionId): Promise<string> {
  const turns = await sdk.messages.list({ sessionId });
  const texts = turns.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
      : [],
  );
  return texts.at(-1) ?? "";
}

/** Everything the session's event stream has recorded so far. */
export async function eventsSoFar(sdk: Nyte, sessionId: SessionId): Promise<SessionEvent[]> {
  const controller = new AbortController();
  const seen: SessionEvent[] = [];
  try {
    for await (const event of sdk.watch({ sessionId, afterSeq: 0, signal: controller.signal })) {
      if (event.kind === "synced") break;
      seen.push(event);
    }
  } finally {
    controller.abort();
  }
  return seen;
}
