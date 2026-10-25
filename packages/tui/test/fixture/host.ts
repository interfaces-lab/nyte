import { readFile } from "node:fs/promises";
import process from "node:process";
import { dev } from "@nyte-ai/core";
import { composeHost } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import type { ExecutionEnv, GitHubAccountApi, Plugin } from "@nyte-ai/core";
import { chatOnly, fakeModels, testModel } from "@nyte-ai/bench";
import type { FakeModels } from "@nyte-ai/bench";
import questionPlugin from "@nyte-ai/plugin/core/question";
import subagentsPlugin from "@nyte-ai/plugin/core/subagents";
import { asId } from "@nyte-ai/schema";
import type { WorkspaceTarget } from "@nyte-ai/schema";

export type Reply = FakeModels["reply"] extends (...replies: readonly (infer R)[]) => void
  ? R
  : never;

export type TestHostHandle = Awaited<ReturnType<typeof composeHost>>;

export type ProviderRequest = FakeModels["requests"][number];

export interface TestHost extends AsyncDisposable {
  readonly host: TestHostHandle;
  readonly models: FakeModels;
  readonly requests: readonly ProviderRequest[];
  reply(...replies: readonly Reply[]): void;
  requested(count: number, timeout?: number): Promise<ProviderRequest>;
  close(): Promise<void>;
}

export async function openTestHost(options?: {
  readonly plugins?: readonly Plugin<"core">[];
  readonly environment?: Plugin<"core">;
  readonly models?: readonly ReturnType<typeof testModel>[];
  readonly github?: GitHubAccountApi;
  readonly workspace?: WorkspaceTarget;
  readonly loadPlugins?: (paths: readonly string[]) => Promise<readonly Plugin<"core">[]>;
}): Promise<TestHost> {
  dev.off();
  const models = fakeModels({ models: options?.models });

  const host = await composeHost({
    store: memoryStore(),
    models: models.models,
    plugins: [
      options?.environment ?? chatOnly,
      questionPlugin,
      subagentsPlugin,
      ...(options?.plugins ?? []),
    ],
    workspace: options?.workspace ?? { kind: "chat-only", locator: null },
    home: null,
    description: { name: "tui-test", platform: process.platform, version: "0.0.0" },
    github: options?.github,
    loadPlugins: options?.loadPlugins,
  });

  let closed: Promise<void> | null = null;

  const close = (): Promise<void> =>
    (closed ??= (async () => {
      await host.close();
    })());

  return {
    host,
    models,
    requests: models.requests,
    reply: (...replies) => models.reply(...replies),
    requested: (count, timeout) => until(() => models.requests[count - 1], timeout),
    close,
    [Symbol.asyncDispose]: close,
  };
}

export async function until<T>(
  read: () => Promise<T | undefined> | T | undefined,
  timeout = 3_000,
): Promise<T> {
  const deadline = Date.now() + timeout;

  for (;;) {
    const value = await read();

    if (value !== undefined) return value;

    if (Date.now() > deadline) throw new Error("Timed out waiting for a condition.");
    await Bun.sleep(5);
  }
}

export function testEnvironment(exec: ExecutionEnv["exec"]): Plugin<"core"> {
  const base = chatOnly.environment;

  if (base === undefined) throw new Error("chatOnly provides no environment.");

  return {
    id: "test-environment",
    environment: {
      kind: base.kind,
      inspect: (target) => base.inspect(target),
      async attach(target) {
        const env = await base.attach(target);

        return {
          ...env,
          files: {
            ...env.files,
            read: async (path) => ({
              kind: "text",
              path,
              contents: await readFile(path, "utf8"),
              version: asId("v1"),
            }),
          },
          exec,
        };
      },
    },
  };
}
