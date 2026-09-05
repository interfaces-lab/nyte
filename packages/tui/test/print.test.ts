/**
 * Print mode under cancellation and failure.
 *
 * The signal tests run `runPrint` in this process against the sandbox world,
 * as the QA driver runs the interactive TUI, so the signal can be raised at a
 * chosen instant: synchronously after the call, before its first await
 * resolves. The run-following tests drive `followRun` over a real `createUji`
 * whose verbs are wrapped thinly to fail or to raise the signal mid-step.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, test } from "node:test";
import type { Model } from "@uji-ai/ai";
import { createUji } from "@uji-ai/core";
import type { Uji } from "@uji-ai/core";
import { parseFlags } from "../src/flags.ts";
import { followRun, outputLine, printLifetime, reportRun, runPrint } from "../src/print.ts";
import type { PrintSdk } from "../src/print.ts";
import { startMockProvider } from "./sandbox/provider.ts";
import { findScenario } from "./sandbox/scenarios.ts";
import { createSandbox, seedHome } from "./sandbox/seed.ts";
import { inlinePlugin, systemPromptPlugin } from "@uji-ai/core/plugins";
import { SqliteSessionRepo } from "@uji-ai/core/store";

type Signal = "SIGINT" | "SIGTERM";

const FLAGS = parseFlags(["-p", "hello"]);

interface Outcome {
  /** Whether a handler for the signal existed when it was raised. */
  handled: boolean;
  exitCode: typeof process.exitCode;
  stdout: string[];
  sessions: number;
  listeners: number;
}

/** Boot the sandbox, start a print run, raise `signal` at once, and collect what happened. */
async function cancelBeforeStartup(signal: Signal): Promise<Outcome> {
  const provider = await startMockProvider();
  const root = await mkdtemp(join(tmpdir(), "uji-print-"));
  const previous = {
    cwd: process.cwd(),
    home: process.env["HOME"],
    ujiHome: process.env["UJI_HOME"],
    skipVersion: process.env["UJI_SKIP_VERSION_CHECK"],
    exitCode: process.exitCode,
    write: process.stdout.write.bind(process.stdout),
    listeners: process.listenerCount(signal),
  };
  const stdout: string[] = [];
  try {
    const sandbox = await createSandbox(root, findScenario("tools"));
    await seedHome(sandbox, provider.baseUrl);
    process.env["HOME"] = sandbox.home;
    process.env["UJI_HOME"] = sandbox.home;
    process.env["UJI_SKIP_VERSION_CHECK"] = "1";
    process.chdir(sandbox.workspace);
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      stdout.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;

    const running = runPrint(FLAGS);
    const handled = process.emit(signal, signal);
    await running;

    const repo = new SqliteSessionRepo(join(sandbox.workspace, ".uji", "sessions.db"));
    const sessions = (await repo.list()).length;
    await repo.close();
    return {
      handled,
      exitCode: process.exitCode,
      stdout,
      sessions,
      listeners: process.listenerCount(signal),
    };
  } finally {
    process.stdout.write = previous.write;
    // `undefined` does not clear a code once set; 0 is what an unset code means.
    process.exitCode = previous.exitCode ?? 0;
    process.chdir(previous.cwd);
    restore("HOME", previous.home);
    restore("UJI_HOME", previous.ujiHome);
    restore("UJI_SKIP_VERSION_CHECK", previous.skipVersion);
    await provider.close();
    await rm(root, { recursive: true, force: true });
  }
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

const model: Model<"openai-responses"> = {
  id: "test-model",
  name: "Test model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

/** A real SDK over a throwaway store. No test here lets a run reach the provider. */
async function openSdk(): Promise<{ uji: Uji; close: () => Promise<void> }> {
  const cwd = await mkdtemp(join(tmpdir(), "uji-print-sdk-"));
  const store = new SqliteSessionRepo(join(cwd, "sessions.db"));
  const uji = await createUji({
    store,
    streamFn: () => {
      throw new Error("no run is expected");
    },
    models: {
      getModels: () => [model],
      getModel: (_provider, id) => (id === model.id ? model : undefined),
      checkAuth: async () => undefined,
      getProvider: (id) => (id === model.provider ? { id } : undefined),
    },
    model,
    plugins: [inlinePlugin(systemPromptPlugin("test"))],
    env: { cwd },
  });
  return {
    uji,
    close: async () => {
      await uji.close();
      await store.close();
      await rm(cwd, { recursive: true, force: true });
    },
  };
}

function withTimeout<T>(promise: Promise<T>, what: string, ms = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(what)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

void describe("print mode", () => {
  for (const [signal, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const) {
    void test(`${signal} before startup persists nothing and exits ${String(code)}`, async () => {
      const before = process.listenerCount(signal);
      const outcome = await cancelBeforeStartup(signal);
      // The handler existed before the first await, so nothing could outrun it.
      assert.equal(outcome.handled, true);
      assert.equal(outcome.exitCode, code);
      assert.deepEqual(outcome.stdout, []);
      assert.equal(outcome.sessions, 0);
      assert.equal(outcome.listeners, before);
    });
  }

  void test("a failure after the watcher starts stops the watcher before it is awaited", async () => {
    const { uji, close } = await openSdk();
    const lifetime = printLifetime();
    try {
      const { sessionId } = await uji.sessions.create();
      // The SDK's verbs close over their own state and never read `this`, so
      // a namespace may be spread and one verb replaced.
      const sdk: PrintSdk = {
        watch: (input) => uji.watch(input),
        sessions: uji.sessions,
        runs: uji.runs,
        messages: {
          ...uji.messages,
          send: async () => {
            throw new Error("send failed");
          },
        },
      };
      const following = followRun(
        { sdk, sessionId, provider: model.provider },
        { content: "hello" },
        FLAGS,
        lifetime,
        outputLine(),
      );
      // A live watch ends only on its signal: without the stop it never settles.
      await assert.rejects(withTimeout(following, "the watcher was never stopped"), {
        message: "send failed",
      });
    } finally {
      lifetime.dispose();
      await close();
    }
  });

  void test("a signal during the model declaration leaves the effort and the send unstarted", async () => {
    const { uji, close } = await openSdk();
    const lifetime = printLifetime();
    try {
      const { sessionId } = await uji.sessions.create();
      const configured: string[] = [];
      let sends = 0;
      const sdk: PrintSdk = {
        watch: (input) => uji.watch(input),
        runs: uji.runs,
        sessions: {
          ...uji.sessions,
          configure: async (input) => {
            configured.push(input.model === undefined ? "thinkingLevel" : "model");
            process.emit("SIGINT", "SIGINT");
            return uji.sessions.configure(input);
          },
        },
        messages: {
          ...uji.messages,
          send: async (input) => {
            sends += 1;
            return uji.messages.send(input);
          },
        },
      };
      await assert.rejects(
        followRun(
          { sdk, sessionId, provider: model.provider },
          {
            model: { provider: model.provider, id: model.id },
            thinkingLevel: "medium",
            content: "hello",
          },
          FLAGS,
          lifetime,
          outputLine(),
        ),
        { name: "PrintCancelled" },
      );
      assert.deepEqual(configured, ["model"]);
      assert.equal(sends, 0);
      assert.equal(lifetime.exitCode(), 130);
      // The declaration in flight landed; nothing after it started.
      const info = await uji.sessions.get({ sessionId });
      assert.equal(info?.config.model?.id, model.id);
      assert.equal(info?.config.thinkingLevel, undefined);
      // The declaration is a tree entry, not a message: the context is still empty.
      assert.deepEqual(await uji.messages.context({ sessionId }), []);
    } finally {
      lifetime.dispose();
      await close();
    }
  });

  void test("a signal during the durable replay reports nothing", async () => {
    const { uji, close } = await openSdk();
    const lifetime = printLifetime();
    const previousWrite = process.stdout.write.bind(process.stdout);
    const previousError = console.error.bind(console);
    const written: string[] = [];
    process.stdout.write = ((chunk: string | Uint8Array): boolean => {
      written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    }) as typeof process.stdout.write;
    console.error = (...args: unknown[]): void => {
      written.push(args.map(String).join(" "));
    };
    try {
      const { sessionId } = await uji.sessions.create();
      const sdk: PrintSdk = {
        // The signal lands as the replay opens, after the checkpoint that let it start.
        watch: (input) => {
          process.emit("SIGINT", "SIGINT");
          return uji.watch(input);
        },
        sessions: uji.sessions,
        runs: uji.runs,
        messages: uji.messages,
      };
      for (const json of [false, true]) {
        await assert.rejects(
          reportRun({ sdk, sessionId, provider: model.provider }, { ...FLAGS, json }, lifetime),
          { name: "PrintCancelled" },
        );
      }
      // Neither the "did not complete" error nor a result reached either stream.
      assert.deepEqual(written, []);
      assert.equal(lifetime.exitCode(), 130);
    } finally {
      console.error = previousError;
      process.stdout.write = previousWrite;
      lifetime.dispose();
      await close();
    }
  });
});
