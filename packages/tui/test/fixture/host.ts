/**
 * A real host in this process: `composeHost` over a `memoryStore`, a
 * chat-only workspace, the question plugin, and a scripted provider `test`
 * (model `test/model`) from `@nyte-ai/host/bench`. App tests drive the TUI
 * against it and assert on what the provider received. Core's DEV log is
 * silenced while tests run.
 *
 *   await using fixture = await openTestHost();
 *   fixture.reply({ content: [{ type: "text", text: "Hello." }] });
 *   const session = await fixture.host.sessions.create();
 *   await session.send("hi");
 *   const request = await fixture.requested(1);
 */
import process from "node:process";
import { composeHost, dev, memoryStore } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/core";
import { chatOnly, fakeModels } from "@nyte-ai/host/bench";
import type { FakeModels } from "@nyte-ai/host/bench";
import questionPlugin from "@nyte-ai/plugin/question";

/** One scripted provider answer (`content` blocks, an `error`, `hold` until aborted, `until` a promise settles), or a function of the request it answers. */
export type Reply = FakeModels["reply"] extends (...replies: readonly (infer R)[]) => void
  ? R
  : never;

/** The composed host: every `Host` operation except `listen`. */
export type TestHostHandle = Awaited<ReturnType<typeof composeHost>>;

/** One request the scripted provider received. */
export type ProviderRequest = FakeModels["requests"][number];

export interface TestHost extends AsyncDisposable {
  readonly host: TestHostHandle;
  readonly models: FakeModels;
  /** Every request the provider received, in order. */
  readonly requests: readonly ProviderRequest[];
  /** Queues replies, answered in order; an unscripted request fails with a provider error. */
  reply(...replies: readonly Reply[]): void;
  /** Resolves with the `count`-th request (1-based) once the provider has received it. */
  requested(count: number, timeout?: number): Promise<ProviderRequest>;
  close(): Promise<void>;
}

export async function openTestHost(options?: {
  readonly plugins?: readonly Plugin<"core">[];
}): Promise<TestHost> {
  dev.off();
  const models = fakeModels();

  const host = await composeHost({
    store: memoryStore(),
    models: models.models,
    plugins: [chatOnly, questionPlugin, ...(options?.plugins ?? [])],
    workspace: { kind: "chat-only", locator: null },
    home: null,
    operations: [],
    description: { name: "tui-test", platform: process.platform, version: "0.0.0" },
  });

  let closed: Promise<void> | null = null;
  const close = (): Promise<void> => (closed ??= host.close());

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

/** Resolves with the first defined value `read` returns, polling every 5 ms; rejects after `timeout` ms. */
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
