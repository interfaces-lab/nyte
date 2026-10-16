import process from "node:process";
import { composeHost, dev, memoryStore } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/core";
import { chatOnly, fakeModels, testModel } from "@nyte-ai/host/bench";
import type { FakeModels } from "@nyte-ai/host/bench";
import questionPlugin from "@nyte-ai/plugin/core/question";

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
  /** The fake provider's catalog; default one model `model` without thinking levels. */
  readonly models?: readonly ReturnType<typeof testModel>[];
}): Promise<TestHost> {
  dev.off();
  const models = fakeModels({ models: options?.models });

  const host = await composeHost({
    store: memoryStore(),
    models: models.models,
    plugins: [chatOnly, questionPlugin, ...(options?.plugins ?? [])],
    workspace: { kind: "chat-only", locator: null },
    home: null,
    description: { name: "tui-test", platform: process.platform, version: "0.0.0" },
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
