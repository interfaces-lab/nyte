import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import process from "node:process";
import {
  createAssistantMessageEventStream,
  createModels,
  InMemoryCredentialStore,
  InMemoryModelsStore,
} from "@nyte-ai/ai";
import type { Provider } from "@nyte-ai/ai";
import { localProvider, sqliteStore } from "@nyte-ai/host";
import type { Api, AssistantMessage, Model } from "@nyte-ai/schema/model";
import { sdk } from "@nyte-ai/sdk";
import { ARCHIVED_SESSION_COUNT, E2E_PORT, E2E_TOKEN } from "./address.ts";

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

const echo: Provider["stream"] = (selected, context) => {
  const message = context.messages.findLast((candidate) => candidate.role === "user");

  const said =
    message?.role !== "user"
      ? ""
      : Array.isArray(message.content)
        ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
        : message.content;

  const text = `Echo: ${said}`;

  const answer: AssistantMessage = {
    role: "assistant",
    api: selected.api,
    provider: selected.provider,
    model: selected.id,
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

  const events = createAssistantMessageEventStream();
  events.push({ type: "start", partial: { ...answer, content: [] } });
  events.push({ type: "text_delta", contentIndex: 0, delta: text, partial: answer });
  events.push({ type: "done", reason: "stop", message: answer });

  return events;
};

const models = createModels({
  credentials: new InMemoryCredentialStore(),
  modelsStore: new InMemoryModelsStore(),
});

models.setProvider({
  id: model.provider,
  name: "Echo",
  auth: { apiKey: { name: "Fixture", resolve: async () => ({ auth: { apiKey: "fixture" } }) } },
  getModels: () => [model],
  stream: echo,
  streamSimple: echo,
});

const appRoot = join(import.meta.dirname, "../../dist");

if (!existsSync(join(appRoot, "index.html"))) {
  process.stderr.write("Run pnpm --dir packages/app build first\n");
  process.exit(1);
}

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".json": "application/json",
};

async function serveApp(request: Request): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/.nyte") || request.method !== "GET") return undefined;
  const path = normalize(join(appRoot, pathname));
  const file =
    path.startsWith(appRoot) && extname(path) !== "" ? path : join(appRoot, "index.html");

  try {
    return new Response(await readFile(file), {
      headers: { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const cwd = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-web-")));

await writeFile(join(cwd, "README.md"), "# E2E workspace\n\nThe workspace reached the browser.\n");

for (const args of [
  ["init", "-q"],
  ["config", "user.name", "E2E Author"],
  ["config", "user.email", "e2e@example.test"],
  ["add", "--", "README.md"],
  ["commit", "-qm", "Seed workspace"],
])
  execFileSync("git", args, { cwd });

const host = await sdk.open({
  store: sqliteStore({ memory: true }),
  models,
  plugins: [{ id: "local", environment: localProvider({ home: cwd }) }],
  workspace: { kind: "local", path: cwd },
  home: cwd,
});

for (let index = 1; index <= ARCHIVED_SESSION_COUNT; index += 1) {
  const session = await host.sessions.create({ name: `Archived chat ${String(index)}` });
  await session.update({ archived: true });
}

const listener = await host.listen({
  transport: { kind: "http", hostname: "127.0.0.1", port: E2E_PORT },
  auth: { kind: "token", token: E2E_TOKEN },
  before: serveApp,
});

const stop = (): void => {
  void listener
    .close()
    .then(() => host.close())
    .then(() => rm(cwd, { recursive: true, force: true }))
    .finally(() => process.exit(0));
};

process.once("SIGINT", stop);

process.once("SIGTERM", stop);

process.stdout.write(`Serving the e2e app at http://127.0.0.1:${String(E2E_PORT)}\n`);
