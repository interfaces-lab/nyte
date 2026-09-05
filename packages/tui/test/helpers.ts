/**
 * A real host over a temp SQLite store with a scripted provider: the same
 * technique core's own SDK suite uses. Nothing here is a mock.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { StreamFn } from "@nyte-ai/core";
import { definePlugin, inlinePlugin, type LoadedPlugin } from "@nyte-ai/core/plugins";
import type { Api, AssistantMessage, Model, Usage } from "@nyte-ai/schema";
import { Host } from "../src/host.ts";

export const model: Model<Api> = {
  id: "echo-model",
  name: "Echo",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const usage: Usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function answer(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text }],
    api: "openai-responses",
    provider: "openai",
    model: model.id,
    usage,
    stopReason: "stop",
    timestamp: 1_000,
  };
}

export interface Gate {
  readonly opened: Promise<void>;
  release(): void;
}

export function gate(): Gate {
  let release: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    opened,
    release: () => release?.(),
  };
}

/**
 * Answers with how many user messages it saw, in two deltas, after `gate`
 * (if any) opens. A real provider stream ends when its request is aborted;
 * so does this one.
 */
export function echo(options: { readonly gate?: Gate } = {}): StreamFn {
  return (_model, context, streamOptions) => {
    const users = context.messages.filter((item) => item.role === "user").length;
    const message = answer(`saw ${String(users)}`);
    const stream = createAssistantMessageEventStream();
    const aborted = new Promise<"aborted">((resolve) => {
      const signal = streamOptions?.signal;
      if (signal === undefined) return;
      if (signal.aborted) resolve("aborted");
      else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    void (async () => {
      stream.push({ type: "start", partial: { ...message, content: [] } });
      stream.push({ type: "text_delta", contentIndex: 0, delta: "saw ", partial: message });
      const outcome = await Promise.race([options.gate?.opened ?? Promise.resolve(), aborted]);
      if (outcome === "aborted") {
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...message, stopReason: "aborted", content: [{ type: "text", text: "saw " }] },
        });
        return;
      }
      stream.push({
        type: "text_delta",
        contentIndex: 0,
        delta: String(users),
        partial: message,
      });
      stream.push({ type: "done", reason: "stop", message });
    })();
    return stream;
  };
}

function plugins(): LoadedPlugin[] {
  return [
    inlinePlugin(
      definePlugin({
        id: "prompt",
        session(api) {
          api.prompt.add((draft) => draft.set("p", { text: "You are a test." }));
        },
      }),
    ),
  ];
}

const directories: string[] = [];
const hosts: Host[] = [];

afterEach(async () => {
  for (const host of hosts.splice(0).toReversed()) await host.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

export async function openHost(
  streamFn: StreamFn = echo(),
  extraPlugins: readonly LoadedPlugin[] = [],
): Promise<Host> {
  const directory = mkdtempSync(join(tmpdir(), "nyte-tui-"));
  directories.push(directory);
  const host = await Host.open({
    cwd: directory,
    // A workspace that has never run nyte has no `.nyte/` yet; the host makes it.
    storePath: join(directory, ".nyte", "sessions.db"),
    streamFn,
    models: {
      getModels: () => [model],
      getModel: (_provider, id) => (id === model.id ? model : undefined),
    },
    model,
    plugins: [...plugins(), ...extraPlugins],
    watchPollIntervalMs: 5,
  });
  hosts.push(host);
  return host;
}

export async function within<T>(promise: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`timed out after ${String(timeoutMs)}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([promise, expired]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Resolve once `check` holds: for the state already published, else for the
 * next one that satisfies it. A state that arrived before the wait began
 * still counts, so a fast runner cannot race the test.
 */
export function untilState<T>(
  source: {
    readonly current: () => T | undefined;
    readonly subscribe: (listener: (value: T) => void) => () => void;
  },
  check: (value: T) => boolean,
): Promise<T> {
  const now = source.current();
  if (now !== undefined && check(now)) return Promise.resolve(now);
  return within(
    new Promise<T>((resolve) => {
      const stop = source.subscribe((value) => {
        if (!check(value)) return;
        stop();
        resolve(value);
      });
    }),
  );
}
