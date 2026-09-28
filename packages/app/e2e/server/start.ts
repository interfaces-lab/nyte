/**
 * The web project's server: `@nyte-ai/serve` over an in-memory SDK whose
 * provider answers "Echo: <last user text>" without a network, serving the
 * built app from the same origin.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import { createNyte } from "@nyte-ai/core";
import { SqliteStore } from "@nyte-ai/core/store";
import { createWorkspaceBackend, WorkspaceStore } from "@nyte-ai/host";
import type { SessionId } from "@nyte-ai/core";
import type { Api, AssistantMessage, Context, Model } from "@nyte-ai/schema";
// Relative: a package dependency on serve, which depends on this app, is a turbo task cycle.
import { appDistRoot, startServe } from "../../../serve/src/index.ts";
import { E2E_PORT, E2E_TOKEN } from "./address.ts";

const model: Model<Api> = {
  id: "echo",
  name: "Echo",
  api: "openai-responses",
  provider: "echo",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

function lastUserText(context: Context): string {
  const message = context.messages.findLast((candidate) => candidate.role === "user");

  if (message?.role !== "user") return "";

  if (typeof message.content === "string") return message.content;

  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function echo(_model: Model<Api>, context: Context) {
  const text = `Echo: ${lastUserText(context)}`;
  const answer: AssistantMessage = {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [{ type: "text", text }],
    stopReason: "stop",
    timestamp: Date.now(),
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
  const stream = createAssistantMessageEventStream();
  stream.push({ type: "start", partial: { ...answer, content: [] } });
  stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: answer });
  stream.push({ type: "done", reason: "stop", message: answer });

  return stream;
}

const appRoot = appDistRoot();

if (!existsSync(join(appRoot, "index.html"))) {
  process.stderr.write("Run pnpm --dir packages/app build first\n");
  process.exit(1);
}

const cwd = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-web-")));
await writeFile(join(cwd, "README.md"), "# E2E workspace\n\nworkspace.read reached the browser.\n");
execFileSync("git", ["init", "-q"], { cwd });
execFileSync("git", ["config", "user.name", "E2E Author"], { cwd });
execFileSync("git", ["config", "user.email", "e2e@example.test"], { cwd });
execFileSync("git", ["add", "--", "README.md"], { cwd });
execFileSync("git", ["commit", "-qm", "Seed workspace"], { cwd });
const workspaces = new WorkspaceStore(join(cwd, ".workspaces.json"));
const workspaceBackend = createWorkspaceBackend(workspaces);
const store = new SqliteStore(":memory:");
const sdk = await createNyte({
  store,
  streamFn: echo,
  models: {
    getModels: () => [model],
    getModel: (provider, id) =>
      provider === model.provider && id === model.id ? model : undefined,
    getAvailable: async () => [model],
  },
  model,
  workspace: { ...workspaceBackend, vcs: undefined },
  plugins: [],
  env: { cwd },
});
const attached = new Set<SessionId>();

const serving = await startServe({
  sdk,
  attach: (sessionId) => {
    if (attached.has(sessionId)) return;
    attached.add(sessionId);
    sdk.attach({ sessions: [sessionId] });
  },
  version: "e2e",
  describe: () => ({ capabilities: { workspace: true }, persistence: "durable" }),
  host: "127.0.0.1",
  port: E2E_PORT,
  token: E2E_TOKEN,
  appRoot,
});

const stop = (): void => {
  void serving
    .close()
    .then(() => sdk.close())
    .then(() => store.close())
    .then(() => rm(cwd, { recursive: true, force: true }))
    .finally(() => process.exit(0));
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
process.stdout.write(`Serving the e2e app at ${serving.address}\n`);
