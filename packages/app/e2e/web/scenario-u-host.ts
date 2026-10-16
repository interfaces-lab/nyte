import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createModels, InMemoryCredentialStore, InMemoryModelsStore } from "@nyte-ai/ai";
import { localProvider, sqliteStore } from "@nyte-ai/host";
import { fakeModels, testModel } from "@nyte-ai/host/bench";
import type { FakeModels } from "@nyte-ai/host/bench";
import { sdk } from "@nyte-ai/sdk";
import { restaurantReplies, restaurantSkill } from "./scenario-u-fixture.ts";

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

/** The built web app's file for `request`, or its index for a route; undefined for the host's own paths. The canvas shell is open to any origin, as `public/vercel.json` serves it, since its sandboxed frame loads it from an opaque origin. */
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

/** A host serving the web app for scenario U, as a machine the browser pairs with. */
export interface ScenarioHost {
  readonly origin: string;
  readonly fake: FakeModels;
  /** The link that pairs a browser with this host. */
  readonly pairing: string;
  close(): Promise<void>;
}

/**
 * Opens a host over the SQLite file `database` with `home` as its home and
 * workspace, answering scenario U's chat (canvas links on `places`), and
 * serves it with the built web app on `port` behind `token`. Opening it
 * again over the same file and home is a restart.
 */
export async function openScenarioHost(input: {
  readonly database: string;
  readonly home: string;
  readonly port: number;
  readonly token: string;
  readonly places: string;
}): Promise<ScenarioHost> {
  const pick = restaurantReplies({ skill: restaurantSkill(input.home), origin: input.places });

  const fake = fakeModels({
    id: "e2e",
    name: "E2E",
    models: [testModel("scripted", { name: "Scripted", provider: "e2e" })],
    into: createModels({
      credentials: new InMemoryCredentialStore(),
      modelsStore: new InMemoryModelsStore(),
    }),
    fallback: (request) =>
      pick(request) ?? { error: "Scenario U's host answers only its own chat." },
  });

  const host = await sdk.open({
    store: sqliteStore({ path: input.database }),
    models: fake.models,
    plugins: [{ id: "local", environment: localProvider({ home: input.home }) }],
    workspace: { kind: "local", path: input.home },
    home: input.home,
  });

  try {
    await host.models.setDefault({ provider: "e2e", id: "scripted" });

    const listener = await host.listen({
      transport: { kind: "http", hostname: "127.0.0.1", port: input.port },
      auth: { kind: "token", token: input.token },
      before: serveApp,
    });

    const origin = `http://127.0.0.1:${String(input.port)}`;

    return {
      origin,
      fake,
      pairing: `${origin}/pair#host=${encodeURIComponent(origin)}&token=${encodeURIComponent(input.token)}`,
      close: async () => {
        await listener.close();
        await host.close();
      },
    };
  } catch (cause) {
    await host.close();
    throw cause;
  }
}
