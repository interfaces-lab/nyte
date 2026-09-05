import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import type {
  Api,
  AssistantMessage,
  Context,
  Model,
  ModelsSimpleStreamOptions,
  Usage,
} from "@uji-ai/ai";
import type { JsonValue } from "@uji-ai/schema";
import type { Message } from "@uji-ai/schema";
import { createChatNamer } from "../src/session-title.ts";
import type { ChatNamer, TitleModels, TitleSession } from "../src/session-title.ts";
import { manifestPluginOptions } from "../src/run.ts";
import { SqliteSessionRepo, newId, type SessionStorage } from "@uji-ai/core/store";

const directories: string[] = [];
const closeAfterTest: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const close of closeAfterTest.splice(0).reverse()) await close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const usage: Usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function makeModel(id: string): Model<"openai-responses"> {
  return {
    id,
    name: id,
    api: "openai-responses",
    provider: "openai",
    baseUrl: "https://example.invalid",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 100_000,
    maxTokens: 10_000,
  };
}

const primaryModel = makeModel("gpt-5.6");
const lunaModel = makeModel("gpt-5.6-luna");

function assistant(model: Model<Api>, text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

interface TitleCall {
  readonly context: Context;
  readonly model: Model<Api>;
  readonly options: ModelsSimpleStreamOptions | undefined;
}

interface FakeCatalog extends TitleModels {
  readonly calls: TitleCall[];
  readonly completed: number;
}

type Respond = (call: TitleCall, index: number) => string | Error | Promise<string | Error>;

function fakeCatalog({
  models = [primaryModel],
  respond = () => "Generated title",
}: {
  models?: readonly Model<Api>[];
  respond?: Respond;
} = {}): FakeCatalog {
  const calls: TitleCall[] = [];
  let completed = 0;
  return {
    calls,
    get completed() {
      return completed;
    },
    getModels: (provider) =>
      provider === undefined ? models : models.filter((model) => model.provider === provider),
    completeSimple: async (model, context, options) => {
      const call = { context, model, options };
      const index = calls.length;
      calls.push(call);
      try {
        const response = await respond(call, index);
        if (response instanceof Error) throw response;
        return assistant(model, response);
      } finally {
        completed += 1;
      }
    },
  };
}

interface OpenChat {
  readonly namer: ChatNamer;
  readonly session: SessionStorage;
  append(message: Message): Promise<void>;
  prompt(text: string): Promise<void>;
}

async function openChat({
  catalog,
  primary = primaryModel,
  options,
  view = (session: SessionStorage): TitleSession => session,
}: {
  catalog: TitleModels;
  primary?: Model<Api>;
  options?: JsonValue;
  view?: (session: SessionStorage) => TitleSession;
}): Promise<OpenChat> {
  const directory = mkdtempSync(join(tmpdir(), "uji-session-title-"));
  directories.push(directory);
  const repo = new SqliteSessionRepo(join(directory, "sessions.db"));
  const session = await repo.create();
  const namer = createChatNamer({
    runtime: () => ({ models: catalog, primary }),
    session: () => view(session),
    ...(options === undefined ? {} : { options }),
  });
  closeAfterTest.push(async () => {
    namer.dispose();
    await session.close();
    await repo.close();
  });

  const append = async (message: Message): Promise<void> => {
    await session.appendEntry({ type: "message", id: newId("e"), message }, "main");
  };
  return {
    namer,
    session,
    append,
    async prompt(text: string) {
      await append({ role: "user", content: text, timestamp: Date.now() });
      namer.onUserMessage();
    },
  };
}

async function waitUntil(
  check: () => boolean | Promise<boolean>,
  description: string,
): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForName(session: SessionStorage, expected: string): Promise<void> {
  await waitUntil(async () => (await session.getName()) === expected, `chat name ${expected}`);
}

async function flushBackgroundWork(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

void describe("session-title", () => {
  void test("keeps the title generated for a greeting when later messages arrive", async () => {
    const catalog = fakeCatalog({
      respond: (_call, index) =>
        index === 0 ? "Quick check-in" : "I'll answer that now\n```mermaid\ngraph TD",
    });
    const chat = await openChat({ catalog });

    await chat.prompt("Hi");
    await waitForName(chat.session, "Quick check-in");
    await chat.append(assistant(primaryModel, "Hello. What can I help with?"));
    await chat.prompt("Actually, make the test narrower");
    await flushBackgroundWork();

    assert.equal(await chat.session.getName(), "Quick check-in");
    assert.equal(catalog.calls.length, 1);
    assert.equal(catalog.calls[0]?.context.messages[0]?.content, "Hi");
  });

  void test("uses a small model from the primary provider, then falls back to the primary", async () => {
    const catalog = fakeCatalog({
      models: [primaryModel, lunaModel],
      respond: (_call, index) => (index === 0 ? new Error("small model failed") : "Fallback title"),
    });
    const chat = await openChat({ catalog });

    await chat.prompt("Fix title generation");
    await waitForName(chat.session, "Fallback title");

    assert.deepEqual(
      catalog.calls.map((call) => call.model.id),
      ["gpt-5.6-luna", "gpt-5.6"],
    );
    assert.deepEqual(
      catalog.calls.map((call) => call.options?.reasoning),
      ["minimal", "minimal"],
    );
    const { id: sessionId } = await chat.session.getMetadata();
    assert.ok(catalog.calls.every((call) => call.options?.sessionId === sessionId));
  });

  void test("retries an untitled chat on a later message but still uses the first request", async () => {
    const catalog = fakeCatalog({
      respond: (_call, index) => (index === 0 ? new Error("offline") : "Recovered title"),
    });
    const chat = await openChat({ catalog });

    await chat.prompt("First request");
    await waitUntil(() => catalog.completed === 1, "failed title request");
    await flushBackgroundWork();
    assert.equal(await chat.session.getName(), undefined);

    await chat.prompt("Second request");
    await waitForName(chat.session, "Recovered title");

    assert.equal(catalog.calls.length, 2);
    assert.deepEqual(
      catalog.calls.map((call) => call.context.messages[0]?.content),
      ["First request", "First request"],
    );
  });

  void test("drops automatic triggers while one title request is in flight", async () => {
    const first = Promise.withResolvers<string | Error>();
    const catalog = fakeCatalog({
      respond: (_call, index) => (index === 0 ? first.promise : "Retried title"),
    });
    const chat = await openChat({ catalog });

    await chat.prompt("First request");
    await waitUntil(() => catalog.calls.length === 1, "first title request");
    await chat.prompt("Ignored while naming");
    await flushBackgroundWork();
    assert.equal(catalog.calls.length, 1);

    first.resolve(new Error("failed"));
    await waitUntil(() => catalog.completed === 1, "first title failure");
    await flushBackgroundWork();
    await chat.prompt("Retry after failure");
    await waitForName(chat.session, "Retried title");
    assert.equal(catalog.calls.length, 2);
  });

  void test("does not automatically replace an existing name", async () => {
    const catalog = fakeCatalog();
    const chat = await openChat({ catalog });
    await chat.session.setName("Named by hand");

    await chat.prompt("Do not rename this chat");
    await flushBackgroundWork();

    assert.equal(await chat.session.getName(), "Named by hand");
    assert.equal(catalog.calls.length, 0);
  });

  void test("regenerates from bounded text without reasoning, calls, or tool output", async () => {
    const catalog = fakeCatalog({ respond: () => "OAuth refresh fix" });
    const chat = await openChat({ catalog });
    await chat.session.setName("Old title");
    await chat.append({
      role: "user",
      content: `ORIGINAL_GOAL ${"a".repeat(3_000)} OMITTED_ORIGINAL_END`,
      timestamp: Date.now(),
    });
    await chat.append({
      role: "user",
      content: `OMITTED_OLD_CONTEXT ${"b".repeat(9_000)}`,
      timestamp: Date.now(),
    });
    await chat.append({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "PRIVATE_REASONING" },
        { type: "text", text: "The visible answer is expired OAuth credentials." },
        { type: "toolCall", id: "call-1", name: "bash", arguments: { secret: "CALL_ARGS" } },
      ],
      api: primaryModel.api,
      provider: primaryModel.provider,
      model: primaryModel.id,
      usage,
      stopReason: "toolUse",
      timestamp: Date.now(),
    });
    await chat.append({
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "TERMINAL_OUTPUT" }],
      isError: false,
      timestamp: Date.now(),
    });
    await chat.append({
      role: "user",
      content: "RECENT_GOAL fix token refresh",
      timestamp: Date.now(),
    });

    assert.equal(await chat.namer.nameNow(), "OAuth refresh fix");
    assert.equal(await chat.session.getName(), "OAuth refresh fix");
    const [request] = catalog.calls;
    assert.equal(request?.context.messages.length, 1);
    const content = request?.context.messages[0]?.content;
    assert.equal(typeof content, "string");
    if (typeof content !== "string") return;
    assert.ok(content.length <= 8_000);
    assert.match(content, /^Original request:\nORIGINAL_GOAL/u);
    assert.match(content, /Recent conversation:/u);
    assert.match(content, /The visible answer is expired OAuth credentials\./u);
    assert.match(content, /RECENT_GOAL fix token refresh/u);
    assert.doesNotMatch(content, /OMITTED_ORIGINAL_END|OMITTED_OLD_CONTEXT/u);
    assert.doesNotMatch(content, /PRIVATE_REASONING|CALL_ARGS|TERMINAL_OUTPUT/u);
  });

  void test("starts regenerated recent context after the latest compaction", async () => {
    const catalog = fakeCatalog({ respond: () => "Current work" });
    const chat = await openChat({ catalog });
    await chat.session.setName("Old title");
    await chat.append({ role: "user", content: "Original request", timestamp: Date.now() });
    await chat.append({ role: "user", content: "OLD_CONTEXT", timestamp: Date.now() });
    await chat.session.appendEntry(
      {
        type: "compaction",
        id: newId("e"),
        summary: "COMPACTION_SUMMARY",
        retainedTail: [],
        tokensBefore: 100,
        fromHook: false,
      },
      "main",
    );
    await chat.append({ role: "user", content: "CURRENT_CONTEXT", timestamp: Date.now() });

    await chat.namer.nameNow();

    const content = catalog.calls[0]?.context.messages[0]?.content;
    assert.equal(typeof content, "string");
    if (typeof content !== "string") return;
    assert.match(content, /Original request/u);
    assert.match(content, /CURRENT_CONTEXT/u);
    assert.doesNotMatch(content, /OLD_CONTEXT|COMPACTION_SUMMARY/u);
  });

  void test("keeps the old name when explicit regeneration fails", async () => {
    const catalog = fakeCatalog({
      models: [primaryModel, lunaModel],
      respond: () => new Error("provider unavailable"),
    });
    const chat = await openChat({ catalog });
    await chat.session.setName("Keep this title");
    await chat.append({ role: "user", content: "Try another title", timestamp: Date.now() });

    assert.equal(await chat.namer.nameNow(), undefined);
    assert.equal(await chat.session.getName(), "Keep this title");
    assert.deepEqual(
      catalog.calls.map((call) => call.model.id),
      ["gpt-5.6-luna", "gpt-5.6"],
    );
  });

  void test("a manual rename completed during generation wins", async () => {
    const response = Promise.withResolvers<string | Error>();
    const catalog = fakeCatalog({ respond: () => response.promise });
    const chat = await openChat({ catalog });

    await chat.prompt("Generate a title");
    await waitUntil(() => catalog.calls.length === 1, "title request");
    await chat.session.setName("Manual title");
    response.resolve("Generated title");
    await waitUntil(() => catalog.completed === 1, "generated title response");
    await flushBackgroundWork();

    assert.equal(await chat.session.getName(), "Manual title");
  });

  void test("uses the first nonempty output line and caps the stored title at 100 characters", async () => {
    const generated = "x".repeat(101);
    const catalog = fakeCatalog({ respond: () => `\n  ${generated}  \nIgnored explanation` });
    const chat = await openChat({ catalog });

    await chat.prompt("Make a long title");
    await waitForName(chat.session, `${"x".repeat(97)}...`);

    assert.equal(await chat.session.getName(), `${"x".repeat(97)}...`);
  });

  void test("accepts a custom title prompt from the legacy plugin options", async () => {
    const catalog = fakeCatalog();
    const chat = await openChat({ catalog, options: { prompt: "Use three words." } });

    await chat.prompt("Name this");
    await waitForName(chat.session, "Generated title");

    assert.equal(catalog.calls[0]?.context.systemPrompt, "Use three words.");
  });

  void test("the manifest can configure or disable the session-title host feature", async () => {
    const directory = mkdtempSync(join(tmpdir(), "uji-title-manifest-"));
    directories.push(directory);
    assert.deepEqual(await manifestPluginOptions(directory, "session-title"), {
      disabled: false,
    });

    mkdirSync(join(directory, ".uji"), { recursive: true });
    writeFileSync(
      join(directory, ".uji", "uji.json"),
      JSON.stringify({ plugins: [{ id: "session-title", options: { prompt: "Name it" } }] }),
    );
    assert.deepEqual(await manifestPluginOptions(directory, "session-title"), {
      disabled: false,
      options: { prompt: "Name it" },
    });

    writeFileSync(
      join(directory, ".uji", "uji.json"),
      JSON.stringify({ plugins: ["-session-title"] }),
    );
    assert.deepEqual(await manifestPluginOptions(directory, "session-title"), {
      disabled: true,
    });
  });
});
