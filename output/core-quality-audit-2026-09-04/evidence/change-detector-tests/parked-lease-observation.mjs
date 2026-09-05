import { createAssistantMessageEventStream } from "/Users/workgyver/Developer/nyte/packages/ai/src/index.ts";
import { SqliteStore } from "/Users/workgyver/Developer/nyte/packages/core/src/kernel/sqlite.ts";
import { createNyte } from "/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/nyte.ts";
import {
  definePlugin,
  inlinePlugin,
} from "/Users/workgyver/Developer/nyte/packages/core/src/plugins/types.ts";
import { ToolWait } from "/Users/workgyver/Developer/nyte/packages/core/src/types.ts";

// Real storage with delayed delivery of the runner's own parking event and
// delayed completion of the subsequent acquire. This schedules a legal
// interleaving without changing stored state or invoking kernel helpers.
const sqlite = new SqliteStore(":memory:");
const parkingEvent = Promise.withResolvers();
const acquiredWhileParked = Promise.withResolvers();
const finishAcquire = Promise.withResolvers();
let waitReturned = false;
let watches = 0;
let observers;
function wrap(session) {
  observers = session;
  return {
    ...session,
    id: session.id,
    objects: session.objects,
    refs: session.refs,
    close: () => session.close(),
    events: {
      append: (...args) => session.events.append(...args),
      read: (...args) => session.events.read(...args),
      last: () => session.events.last(),
      floor: () => session.events.floor(),
      trim: (...args) => session.events.trim(...args),
      async *watch(options) {
        const runner = watches++ === 0;
        for await (const event of session.events.watch(options)) {
          if (runner && event.kind === "ref" && event.reason === "wait") await parkingEvent.promise;
          yield event;
        }
      },
    },
    leases: {
      read: (...args) => session.leases.read(...args),
      release: (...args) => session.leases.release(...args),
      renew: (...args) => session.leases.renew(...args),
      async acquire(name, ttlMs) {
        const result = await session.leases.acquire(name, ttlMs);
        if (result.ok && waitReturned) {
          const oid = await session.refs.read("refs/runs/main");
          const run = oid === null ? undefined : await session.objects.get(oid);
          if (run?.kind === "run" && run.phase.kind === "waiting") {
            acquiredWhileParked.resolve();
            await finishAcquire.promise;
          }
        }
        return result;
      },
    },
  };
}
const store = {
  create: async (options) => wrap(await sqlite.create(options)),
  open: async (id) => wrap(await sqlite.open(id)),
  list: () => sqlite.list(),
  delete: (id) => sqlite.delete(id),
  close: () => sqlite.close(),
};
const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const model = {
  id: "test",
  name: "Test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: usage.cost,
  contextWindow: 10000,
  maxTokens: 100,
};
let providerRequests = 0;
let toolExecutions = 0;
const plugin = inlinePlugin(
  definePlugin({
    id: "ask",
    session(api) {
      api.tools.add((draft) =>
        draft.set("ask", {
          name: "ask",
          description: "Ask a question",
          parameters: { type: "object", properties: {} },
          execute: async () => {
            toolExecutions++;
            throw new ToolWait();
          },
          wake: async () => ({
            kind: "settle",
            result: { content: [{ type: "text", text: "blue" }], details: {} },
          }),
        }),
      );
    },
  }),
);
const nyte = await createNyte({
  store,
  model,
  models: { getModels: () => [model], getModel: () => model },
  plugins: [plugin],
  env: { cwd: "/tmp" },
  streamFn: () => {
    providerRequests++;
    const stream = createAssistantMessageEventStream();
    const answer = {
      role: "assistant",
      content: [{ type: "toolCall", id: "ask-1", name: "ask", arguments: {} }],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage,
      stopReason: "toolUse",
      timestamp: 1,
    };
    stream.push({ type: "done", reason: "toolUse", message: answer });
    return stream;
  },
});
let timer;
try {
  const { sessionId } = await nyte.sessions.create();
  nyte.attach();
  await new Promise((resolve) => setImmediate(resolve));
  await nyte.messages.send({ sessionId, content: "ask" });
  const parked = await nyte.runs.wait({ sessionId });
  waitReturned = true;
  const before = { providerRequests, toolExecutions, seq: await observers.events.last() };
  parkingEvent.resolve();
  await Promise.race([
    acquiredWhileParked.promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("No delayed wake within 2 seconds")), 2000);
    }),
  ]);
  clearTimeout(timer);
  const current = await nyte.runs.current({ sessionId });
  finishAcquire.resolve();
  await new Promise((resolve) => setTimeout(resolve, 25));
  const settled = await nyte.runs.current({ sessionId });
  const after = { providerRequests, toolExecutions, seq: await observers.events.last() };
  console.log(
    JSON.stringify({
      wait: parked.kind,
      laterPhase: current?.phase.kind,
      laterLeasePresent: current?.lease !== undefined,
      settledLeasePresent: settled?.lease !== undefined,
      before,
      after,
    }),
  );
} finally {
  clearTimeout(timer);
  parkingEvent.resolve();
  finishAcquire.resolve();
  await nyte.close();
  await sqlite.close();
}
