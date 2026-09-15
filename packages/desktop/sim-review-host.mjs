/**
 * Scratch host for simulator review. Serves a seeded, in-memory Nyte over
 * loopback on the port the simulator already has saved, and accepts any bearer
 * token so the phone reconnects without retyping anything. Not shipped.
 */
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createNyte } from "@nyte-ai/core";
import { createNyteServer } from "@nyte-ai/server";
import { SqliteStore } from "@nyte-ai/core/store";

const PORT = Number(process.argv[2] ?? 58461);

const model = {
  id: "fable-5.1",
  name: "Claude Fable 5.1",
  api: "anthropic-messages",
  provider: "anthropic",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 200000,
  maxTokens: 8000,
};

const sdk = await createNyte({
  store: new SqliteStore("/tmp/nyte-sim-review.db", { watchPollIntervalMs: 5 }),
  streamFn: async function* () {
    yield { type: "text-delta", text: "Scratch host: no model is wired up." };
  },
  model,
  models: {
    getModels: () => [model],
    getModel: (provider, id) =>
      provider === model.provider && id === model.id ? model : undefined,
    getAvailable: async () => [model],
  },
  plugins: [],
  env: { cwd: process.cwd() },
});

const seeds = [
  "Fix the composer stop button",
  "Audit the changed-files screen",
  "Rename the merge chip",
];
const existing = await sdk.sessions.list({});
const count = existing.items?.length ?? 0;
if (count === 0) {
  for (const name of seeds) await sdk.sessions.create({ name });
}

const server = createNyteServer({
  sdk,
  version: "scratch",
  auth: { kind: "custom", authorize: () => ({ kind: "allow" }) },
});
createServer(
  getRequestListener((request) => server.fetch(request), { hostname: "127.0.0.1" }),
).listen(PORT, "127.0.0.1", () => {
  console.log(`scratch host on http://127.0.0.1:${PORT}`);
});
