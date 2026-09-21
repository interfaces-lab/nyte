import assert from "node:assert/strict";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage } from "@nyte-ai/schema";
import type { Drain } from "@nyte-ai/protocol";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { Nyte, NyteOptions, SessionId } from "../../src/kernel/sdk/types.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import { assistant } from "./helpers.ts";

export const acceptanceModel: Model<Api> = {
  id: "acceptance-model",
  name: "Acceptance",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

export function scripted(
  respond: (...args: Parameters<StreamFn>) => AssistantMessage | Promise<AssistantMessage>,
): StreamFn {
  return (...args) => {
    const stream = createAssistantMessageEventStream();
    void (async () => {
      const message = await respond(...args);
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        stream.push({ type: "error", reason: message.stopReason, error: message });
        return;
      }
      if (message.stopReason === "pending") throw new Error("Script left a response pending");
      stream.push({ type: "done", reason: message.stopReason, message });
    })().catch((cause: unknown) => {
      stream.push({
        type: "error",
        reason: "error",
        error: assistant("", {
          stop: "error",
          error: cause instanceof Error ? cause.message : String(cause),
        }),
      });
    });
    return stream;
  };
}

export function openAcceptanceNyte(
  store: Store,
  streamFn: StreamFn = scripted(() => assistant("accepted")),
  options: {
    readonly drain?: Drain;
    readonly plugins?: NyteOptions["plugins"];
  } = {},
): Promise<Nyte> {
  return createNyte({
    store,
    streamFn,
    model: acceptanceModel,
    models: {
      getModels: () => [acceptanceModel],
      getModel: (provider, id) =>
        provider === acceptanceModel.provider && id === acceptanceModel.id
          ? acceptanceModel
          : undefined,
      getAvailable: async () => [acceptanceModel],
    },
    plugins: options.plugins ?? [],
    env: { cwd: "/tmp/nyte-acceptance" },
    ...(options.drain === undefined ? {} : { drain: options.drain }),
  });
}

export async function driveToIdle(nyte: Nyte, sessionId: SessionId, head = "main"): Promise<void> {
  for (let step = 0; step < 250; step += 1) {
    const outcome = await nyte.advance({ sessionId, head });
    if (outcome.kind === "idle") return;
    assert.notEqual(outcome.kind, "busy");
    assert.notEqual(outcome.kind, "retry");
    assert.notEqual(outcome.kind, "waiting");
  }
  assert.fail("run did not become idle within 250 steps");
}

export async function transcriptUsers(
  nyte: Nyte,
  sessionId: SessionId,
  head = "main",
): Promise<string[]> {
  const turns = await nyte.messages.list({ sessionId, head });
  return turns.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.flatMap((part) =>
          part.kind === "user" && !Array.isArray(part.content) ? [part.content] : [],
        )
      : [],
  );
}

export function gateRefUpdate(base: Store): {
  readonly store: Store;
  readonly arm: () => {
    readonly entered: Promise<void>;
    readonly release: () => void;
  };
} {
  let barrier:
    | {
        readonly entered: PromiseWithResolvers<void>;
        readonly released: PromiseWithResolvers<void>;
      }
    | undefined;
  const wrap = (session: Session): Session => ({
    id: session.id,
    objects: session.objects,
    leases: session.leases,
    events: session.events,
    close: () => session.close(),
    refs: {
      read: (name) => session.refs.read(name),
      list: (prefix) => session.refs.list(prefix),
      update: async (updates, options) => {
        const armed = barrier;
        if (armed !== undefined) {
          barrier = undefined;
          armed.entered.resolve();
          await armed.released.promise;
        }
        return session.refs.update(updates, options);
      },
    },
  });
  return {
    store: {
      create: async (options) => wrap(await base.create(options)),
      open: async (id) => wrap(await base.open(id)),
      list: () => base.list(),
      delete: (id) => base.delete(id),
      close: () => base.close(),
    },
    arm: () => {
      if (barrier !== undefined) throw new Error("A ref-update barrier is already armed");
      const entered = Promise.withResolvers<void>();
      const released = Promise.withResolvers<void>();
      barrier = { entered, released };
      return { entered: entered.promise, release: () => released.resolve() };
    },
  };
}
