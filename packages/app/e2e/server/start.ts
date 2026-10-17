import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import process from "node:process";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import { localProvider, sqliteStore } from "@nyte-ai/host";
import { fakeModels, lastUserText, testModel, titleReply } from "@nyte-ai/host/bench";
import { sdk } from "@nyte-ai/sdk";
import { ARCHIVED_SESSION_COUNT, E2E_PORT, E2E_TOKEN, README_LINE } from "./address.ts";

/** The echo provider answers `Echo: <message>`; a title request gets `Echo: <first message>`. */
const { models } = fakeModels({
  id: "echo",
  name: "Echo",
  models: [testModel("echo", { name: "Echo", provider: "echo" })],
  into: createModels({
    credentials: new InMemoryCredentialStore(),
    modelsStore: new InMemoryModelsStore(),
  }),
  fallback: (request) => ({
    content: [{ type: "text", text: `Echo: ${titleReply(request) ?? lastUserText(request)}` }],
  }),
});

const appRoot = join(import.meta.dirname, "../../dist");

if (!existsSync(join(appRoot, "index.html"))) {
  process.stderr.write("Run pnpm --dir packages/app build first\n");
  process.exit(1);
}

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".woff2", "font/woff2"],
  [".json", "application/json"],
]);

async function serveApp(request: Request): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/.nyte") || request.method !== "GET") return undefined;

  const path = normalize(join(appRoot, pathname));

  const file =
    path.startsWith(appRoot) && extname(path) !== "" ? path : join(appRoot, "index.html");

  try {
    return new Response(await readFile(file), {
      headers: { "Content-Type": TYPES.get(extname(file)) ?? "application/octet-stream" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

const cwd = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-web-")));

await writeFile(join(cwd, "README.md"), `# E2E workspace\n\n${README_LINE}\n`);

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
  const { session, receipt } = await host.sessions.start({
    name: `Archived chat ${String(index)}`,
    content: "Archive me",
  });

  await receipt.settled();
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
