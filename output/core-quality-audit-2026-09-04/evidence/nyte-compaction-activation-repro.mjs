import {
  activate,
  turnFor,
} from "/Users/workgyver/Developer/nyte/packages/core/src/kernel/sdk/activation.ts";
import {
  inlinePlugin,
  definePlugin,
} from "/Users/workgyver/Developer/nyte/packages/core/src/plugins/types.ts";
import { SqliteStore } from "/Users/workgyver/Developer/nyte/packages/core/src/kernel/sqlite.ts";
import { createAssistantMessageEventStream } from "/Users/workgyver/Developer/nyte/packages/ai/src/index.ts";
const model = {
  id: "test",
  name: "test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100,
  maxTokens: 50,
};
const usage = {
  input: 100,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 100,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};
const answer = {
  role: "assistant",
  content: [{ type: "text", text: "summary" }],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage,
  stopReason: "stop",
  timestamp: 1,
};
let compactionHooks = 0;
const steps = [];
const active = await activate({
  target: { kind: "new-session" },
  env: { cwd: process.cwd() },
  plugins: [
    inlinePlugin(
      definePlugin({
        id: "check",
        session(api) {
          api.prompt.add((d) => d.set("persona", { text: "NORMAL AGENT PERSONA" }));
          api.hook("before_compaction", () => {
            compactionHooks++;
            return undefined;
          });
          api.hook("before_request", (e) => {
            steps.push(e.step);
          });
        },
      }),
    ),
  ],
});
const prompts = [];
const bound = turnFor(active, {
  model,
  compaction: { enabled: true, reserveTokens: 20, keepRecentTokens: 0 },
  streamFn(_model, context) {
    prompts.push(context.systemPrompt);
    const s = createAssistantMessageEventStream();
    s.push({ type: "done", reason: "stop", message: answer });
    return s;
  },
});
const store = new SqliteStore(":memory:");
const session = await store.create({ id: "demo" });
const held = await session.leases.acquire("refs/heads/main", 30000);
if (!held.ok) throw new Error("lease unavailable");
const run = {
  kind: "run",
  id: "run",
  head: "main",
  phase: { kind: "respond" },
  startedAt: 1,
  attempts: 0,
  config: {},
};
const messages = [
  { role: "user", content: "old request", timestamp: 0 },
  answer,
  { role: "user", content: "new request", timestamp: 2 },
];
const commits = messages.map((message, index) => ({
  oid: String(index),
  commit: {
    kind: "commit",
    parent: index === 0 ? null : String(index - 1),
    body: { kind: "message", message },
    at: index,
  },
}));
const outcome = await bound.turn.respond({
  session,
  lease: held.lease,
  run,
  attempt: 1,
  commits,
  emit() {},
  signal: new AbortController().signal,
});
console.log(
  JSON.stringify({
    kind: outcome.kind,
    providerSystemPrompts: prompts,
    requestHookSteps: steps,
    beforeCompactionCalls: compactionHooks,
  }),
);
await active.close();
await store.close();
