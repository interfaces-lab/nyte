import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import { localGitHubAccount, localProvider, sqliteStore } from "@nyte-ai/host";
import {
  CI_PROMPT,
  ciHome,
  ciScript,
  fakeModels,
  lastUserText,
  testModel,
} from "@nyte-ai/host/bench";
import type {
  CiRepo,
  CiRoute,
  FakeModels,
  Request as ModelRequest,
  ScenarioHome,
  Script,
} from "@nyte-ai/host/bench";
import { getCurrentTools } from "@nyte-ai/schema/model";
import { sdk } from "@nyte-ai/sdk";
import type { Host, Listener } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { pushedCiRepo } from "./scenario-d.ts";

const APP_ROOT = join(import.meta.dirname, "../../dist");

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".woff2", "font/woff2"],
  [".wasm", "application/wasm"],
  [".json", "application/json"],
]);

const MODEL = { provider: "ci", id: "scripted" } as const;

const TOKEN = "nyte-e2e-scenario-d-token-0123456789";

/** Serves the built web app for every GET outside the host's own `/.nyte` routes; the canvas shell open to any origin, as `public/vercel.json` serves it, since its sandboxed frame loads it from an opaque origin. */
async function serveApp(request: Request): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);

  if (pathname.startsWith("/.nyte") || request.method !== "GET") return undefined;
  const path = normalize(join(APP_ROOT, pathname));

  const file =
    path.startsWith(APP_ROOT) && extname(path) !== "" ? path : join(APP_ROOT, "index.html");

  try {
    const type = TYPES.get(extname(file)) ?? "application/octet-stream";

    return new Response(await readFile(file), {
      headers: pathname.startsWith("/canvas/")
        ? { "Content-Type": type, "Access-Control-Allow-Origin": "*" }
        : { "Content-Type": type },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = Value.Parse(Type.Object({ port: Type.Number() }), server.address());
  await new Promise<void>((resolve) => server.close(() => resolve()));

  return port;
}

/** Scenario D's host for the web app, run in the test's own process so its model requests and spans are read directly. */
export interface CiWebHost extends AsyncDisposable {
  readonly origin: string;
  /** The link a browser pairs with. */
  readonly pairing: string;
  readonly repo: CiRepo;
  readonly home: ScenarioHome;
  readonly fake: FakeModels;
  /** The route the scripted model took on its first request: the CI server's tools when they were listed, else `gh`. */
  route(): CiRoute | null;
  /** Closes the host and its listener, runs `whileDown`, and opens them again on the same store and port, as a host restart does. */
  restart(whileDown?: () => Promise<void>): Promise<void>;
}

/**
 * Opens scenario D's host on a free loopback port: a SQLite store in a temp
 * folder, the pushed CI repo as its workspace, a home with the CI skill and,
 * for `mcp`, the CI MCP server, and a scripted model that answers the CI
 * prompt with `ciScript` on the route the first request's tools allow.
 */
export async function ciWebHost(route: CiRoute): Promise<CiWebHost> {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-web-scenario-d-")));
  const repo = await pushedCiRepo(parent);
  const home = await ciHome({ route, root: parent });
  await writeFile(join(home.home, ".zshrc"), "");
  const store = join(parent, "nyte.db");
  const port = await freePort();
  const origin = `http://127.0.0.1:${String(port)}`;
  let turns: Script | undefined;
  let taken: CiRoute | null = null;

  const answer = (request: ModelRequest) => {
    if (request.context.messages.at(-1)?.role === "user" && lastUserText(request) === CI_PROMPT) {
      taken = getCurrentTools(request.context.messages).some(
        (tool) => tool.name === "mcp__ci__list_check_runs",
      )
        ? "mcp"
        : "gh";
      turns = ciScript({ skill: home.skills["ci-triage"] ?? "", route: taken });
    }

    return turns === undefined
      ? { content: [{ type: "text" as const, text: `Echo: ${lastUserText(request)}` }] }
      : turns.answer(request);
  };

  const fake = fakeModels({
    id: MODEL.provider,
    name: "CI",
    models: [testModel(MODEL.id, { name: "Scripted", provider: MODEL.provider })],
    into: createModels({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
    }),
    fallback: answer,
  });

  const open = async (): Promise<{ host: Host; listener: Listener }> => {
    const host = await sdk.open({
      store: sqliteStore({ path: store }),
      models: fake.models,
      plugins: [{ id: "local", environment: localProvider({ home: home.home }) }],
      github: localGitHubAccount({ home: home.home }),
      workspace: { kind: "local", path: repo.root },
      home: home.home,
    });

    await host.models.setDefault(MODEL);

    const listener = await host.listen({
      transport: { kind: "http", hostname: "127.0.0.1", port },
      auth: { kind: "token", token: TOKEN },
      before: serveApp,
    });

    return { host, listener };
  };

  let opened = await open();

  const close = async (): Promise<void> => {
    await opened.listener.close();
    await opened.host.close();
  };

  return {
    origin,
    pairing: `${origin}/pair#host=${encodeURIComponent(origin)}&token=${encodeURIComponent(TOKEN)}`,
    repo,
    home,
    fake,
    route: () => taken,
    async restart(whileDown) {
      await close();
      await whileDown?.();
      opened = await open();
    },
    async [Symbol.asyncDispose]() {
      await close();
      await rm(parent, { recursive: true, force: true });
    },
  };
}
