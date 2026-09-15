import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vitest";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import { createNyte } from "@nyte-ai/core";
import type { SessionId, StreamFn } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import { inlinePlugin } from "@nyte-ai/plugin";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema";
import { browserToolsPlugin } from "./browser-tools.ts";
import type {
  BrowserActionResult,
  BrowserAgent,
  BrowserConsoleEntry,
  BrowserEvaluateResult,
  BrowserPageState,
} from "./browser-agent.ts";

const model: Model<Api> = {
  id: "script",
  name: "Script",
  provider: "fixture",
  api: "openai-responses",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

function pageState(overrides: Partial<BrowserPageState> = {}): BrowserPageState {
  return {
    url: "https://example.test/",
    title: "Example",
    loading: false,
    snapshot: 1,
    viewport: { width: 800, height: 600 },
    scroll: { y: 0, height: 600 },
    nodes: [
      {
        ref: "s1e1",
        role: "button",
        name: "Sign in",
        tag: "button",
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
    totalNodes: 1,
    text: "Hello from the page.",
    blocked: 0,
    error: undefined,
    ...overrides,
  };
}

interface FakeAgent extends BrowserAgent {
  readonly calls: string[];
}

function fakeAgent(state: BrowserPageState = pageState()): FakeAgent {
  const calls: string[] = [];
  const ok = (name: string): Promise<BrowserActionResult> => {
    calls.push(name);
    return Promise.resolve({ kind: "ok", state });
  };
  return {
    calls,
    open: () => ok("open"),
    snapshot: () => ok("snapshot"),
    click: () => ok("click"),
    type: () => ok("type"),
    press: () => ok("press"),
    scroll: () => ok("scroll"),
    wait: () => ok("wait"),
    console: (): readonly BrowserConsoleEntry[] => {
      calls.push("console");
      return [{ level: "error", message: "boom", source: "page", at: 0 }];
    },
    evaluate: (): Promise<BrowserEvaluateResult> => {
      calls.push("evaluate");
      return Promise.resolve({ kind: "value", json: "1" });
    },
    capture: () => Promise.resolve(undefined),
    release: () => {},
    sessionSurfaceId: (session: SessionId) => `stage:session:${session}`,
  };
}

const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

interface Step {
  readonly tool: string;
  readonly args: Record<string, unknown>;
}

/** Calls one tool per user turn, following `steps` in order, then answers in plain text. */
function calls(...steps: readonly Step[]): StreamFn {
  return (_model, context) => {
    const turn = context.messages.filter((message) => message.role === "user").length;
    const step = steps[turn - 1] ?? steps.at(-1);
    const pending = context.messages.at(-1)?.role === "user" && step !== undefined;
    const reason = pending ? "toolUse" : "stop";
    const message: AssistantMessage = {
      role: "assistant",
      content: pending
        ? [{ type: "toolCall", id: `call-${String(turn)}`, name: step.tool, arguments: step.args }]
        : [{ type: "text", text: "done" }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      stopReason: reason,
      timestamp: Date.now(),
      usage: USAGE,
    };
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => stream.push({ type: "done", reason, message }));
    return stream;
  };
}

/** An SDK holding one browser session, torn down when the test ends. */
async function browserSession(agent: BrowserAgent, streamFn: StreamFn) {
  const directory = await mkdtemp(join(tmpdir(), "nyte-browser-tools-"));
  const store = new SqliteStore(join(directory, "sessions.db"));
  const sdk = await createNyte({
    store,
    model,
    streamFn,
    env: { cwd: directory },
    models: { getModels: () => [model], getAvailable: async () => [model], getModel: () => model },
    plugins: [inlinePlugin(browserToolsPlugin({ agent }))],
  });
  sdk.attach();
  onTestFinished(async () => {
    await sdk.close();
    await store.close();
    await rm(directory, { recursive: true, force: true });
  });
  const session = (await sdk.sessions.create()).sessionId;

  const transcript = async () =>
    JSON.stringify(await sdk.sessions.snapshot({ sessionId: session }));
  const parked = async () => {
    const snapshot = await sdk.sessions.snapshot({ sessionId: session });
    return snapshot?.parked?.find((call) => call.selection !== undefined);
  };

  return {
    /** Send a user turn, which makes the scripted model call its next tool. */
    async say(content: string) {
      await sdk.messages.send({ sessionId: session, content });
    },
    /** The access prompt the parked tool call is waiting on. */
    async accessPrompt() {
      await expect.poll(async () => (await parked()) !== undefined).toBe(true);
      const call = await parked();
      assert.ok(call);
      return call;
    },
    /** Answer the access prompt, releasing the parked call. */
    async answer(choice: "full" | "read" | "off") {
      const call = await this.accessPrompt();
      await sdk.runs.reply({
        sessionId: session,
        runId: call.runId,
        callId: call.callId,
        waitId: call.waitId,
        reply: { choices: [choice] },
      });
    },
    /** Wait until the session transcript contains `pattern`. */
    async reports(pattern: RegExp) {
      await expect.poll(async () => pattern.test(await transcript())).toBe(true);
    },
  };
}

test("the first browser call asks for access before anything reaches the page", async () => {
  const agent = fakeAgent();
  const page = await browserSession(
    agent,
    calls({ tool: "browser_open", args: { url: "https://example.test/" } }),
  );

  await page.say("Open the page");

  const prompt = await page.accessPrompt();
  assert.equal(prompt.selection?.title, "Allow browser access for this session?");
  assert.deepEqual(
    prompt.selection?.choices.map((choice) => choice.id),
    ["full", "read", "off"],
  );
  assert.equal(agent.calls.length, 0, "nothing may reach the browser before consent");

  await page.answer("read");
  await page.reports(/Hello from the page/);
  assert.ok(agent.calls.includes("open"));
});

test("a write tool under read-only access asks again before it runs", async () => {
  const agent = fakeAgent();
  const page = await browserSession(
    agent,
    calls({ tool: "browser_click", args: { ref: "s1e1", element: "Sign in" } }),
  );

  await page.say("Click sign in");
  await page.answer("read");

  await page.reports(/requires full browser access/);
  assert.equal(agent.calls.length, 0, "a read-only session may not click");
});

test("turning access off refuses the call", async () => {
  const agent = fakeAgent();
  const page = await browserSession(
    agent,
    calls({ tool: "browser_open", args: { url: "https://example.test/" } }),
  );

  await page.say("Open the page");
  await page.answer("off");

  await page.reports(/Browser access is off for this session/);
  assert.equal(agent.calls.length, 0, "a refused session may not reach the browser");
});

test("a ref whose name is not what the model described is refused", async () => {
  const agent = fakeAgent();
  const page = await browserSession(
    agent,
    calls(
      { tool: "browser_open", args: { url: "https://example.test/" } },
      { tool: "browser_click", args: { ref: "s1e1", element: "Delete account" } },
    ),
  );

  await page.say("Open it");
  await page.answer("full");
  await page.reports(/Hello from the page/);

  await page.say("Click it");

  await page.reports(/Element name mismatch/);
  assert.ok(!agent.calls.includes("click"), "the click must never reach the page");
});

test("a description that adds a role word still matches the element", async () => {
  const agent = fakeAgent();
  const page = await browserSession(
    agent,
    calls(
      { tool: "browser_open", args: { url: "https://example.test/" } },
      { tool: "browser_click", args: { ref: "s1e1", element: "Sign in button" } },
    ),
  );

  await page.say("Open it");
  await page.answer("full");
  await page.reports(/Hello from the page/);

  await page.say("Click it");

  await expect.poll(() => agent.calls.includes("click")).toBe(true);
});

test("a ref the model never saw in a snapshot is refused", async () => {
  const agent = fakeAgent();
  const page = await browserSession(
    agent,
    calls({ tool: "browser_click", args: { ref: "s9e9", element: "Sign in" } }),
  );

  await page.say("Click it");
  await page.answer("full");

  await page.reports(/not in the snapshot you were last shown/);
  assert.ok(!agent.calls.includes("click"), "an invented ref must never reach the page");
});

test("an element with no accessible name is not silently accepted", async () => {
  const unnamedButton = pageState({
    nodes: [
      {
        ref: "s1e1",
        role: "button",
        name: "   ",
        tag: "button",
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
  });
  const agent = fakeAgent(unnamedButton);
  const page = await browserSession(
    agent,
    calls(
      { tool: "browser_open", args: { url: "https://example.test/" } },
      { tool: "browser_click", args: { ref: "s1e1", element: "Sign in" } },
    ),
  );

  await page.say("Open it");
  await page.answer("full");
  await page.reports(/Hello from the page/);

  await page.say("Click it");

  await page.reports(/has no accessible name/);
  assert.ok(!agent.calls.includes("click"), "the click must never reach the page");
});
