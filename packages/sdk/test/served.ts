import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HeadName, SessionId, SessionView } from "@nyte-ai/schema";
import { TOKEN, TOKEN_AUTHORITY } from "@nyte-ai/core/server";
import { memoryStore } from "@nyte-ai/core/store";
import type { Connection, Listener, Plugin } from "@nyte-ai/core";
import type { ServedHost } from "@nyte-ai/core/server";
import type { Kernel } from "@nyte-ai/core/testing";
import { listenFetch, localProvider, seedSigner } from "@nyte-ai/host";
import { chatOnly, fakeModels } from "@nyte-ai/bench";
import type { FakeModels } from "@nyte-ai/bench";
import { composeServer } from "@nyte-ai/core/testing";

export const TOKEN_SECRET = "a-token-of-at-least-16";

export const BASE = "http://host.test";

export type Intercept = (
  request: Request,
  next: (request: Request) => Promise<Response>,
) => Promise<Response>;

export interface Served {
  readonly fake: FakeModels;
  readonly host: ServedHost;
  readonly kernel: Kernel;
  readonly listener: Listener;
  readonly fetch: typeof fetch;
  readonly root: string | null;
  intercept(next: Intercept | null): void;
  view(session: SessionId, head?: HeadName): Promise<SessionView>;
  close(): Promise<void>;
}

export async function served(options?: {
  readonly local?: boolean;
  readonly identity?: boolean;
  readonly loadPlugins?: (paths: readonly string[]) => Promise<readonly Plugin<"core">[]>;
}): Promise<Served> {
  const fake = fakeModels();
  const root = options?.local === true ? await repository() : null;
  const secret = crypto.getRandomValues(new Uint8Array(32));

  const { host, kernel } = await composeServer({
    store: memoryStore(),
    models: fake.models,
    plugins:
      root === null
        ? [chatOnly]
        : [{ id: "local", environment: localProvider({ home: join(root, "home") }) }],
    workspace:
      root === null
        ? { kind: "chat-only", locator: null }
        : { kind: "local", path: join(root, "workspace") },
    home: null,
    description: { name: "test", platform: "darwin", version: "0.1.0" },
    secrets: { key: async () => secret },
    loadPlugins: options?.loadPlugins,
  });

  const listener = await listenFetch(host, {
    transport: { kind: "fetch" },
    auth: { kind: "token", token: TOKEN_SECRET },
    ...(options?.identity === true
      ? {
          identity: await seedSigner(
            host.server.hostId,
            crypto.getRandomValues(new Uint8Array(32)),
          ),
        }
      : {}),
  });

  let route: Intercept | null = null;
  const forward = (request: Request): Promise<Response> => listener.fetch(request);
  const local: Connection = host.server.connect({
    principal: TOKEN,
    authority: TOKEN_AUTHORITY,
    credential: { kind: "token", token: TOKEN_SECRET },
    origin: null,
  });

  return {
    fake,
    host,
    kernel,
    listener,
    root,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const answer = route === null ? forward(request) : route(request, forward);

      return Promise.race([answer, aborted(request.signal)]);
    },
    intercept(next) {
      route = next;
    },
    view: (session, head) =>
      head === undefined ? local.session(session).view() : local.session(session).head(head).view(),
    async close() {
      await listener.close();
      await host.close();

      if (root !== null) await rm(root, { recursive: true, force: true, maxRetries: 10 });
    },
  };
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

export function readOperation(request: Request): string {
  return new URL(request.url).pathname.slice(1);
}

export async function until<T>(
  source: AsyncIterable<T>,
  done: (value: T) => boolean | Promise<boolean>,
  ms = 5_000,
): Promise<T> {
  const iterator = source[Symbol.asyncIterator]();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`No value was accepted within ${ms} ms.`)), ms);
  });

  try {
    for (;;) {
      const next = await Promise.race([iterator.next(), expired]);

      if (next.done === true) throw new Error("The stream ended first.");

      if (await done(next.value)) return next.value;
    }
  } finally {
    clearTimeout(timer);
    await iterator.return?.();
  }
}

async function repository(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-sdk-")));
  const workspace = join(root, "workspace");
  await Promise.all([mkdir(join(root, "home")), mkdir(workspace)]);

  const git = (...args: string[]): void => {
    execFileSync("git", args, {
      cwd: workspace,
      env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
    });
  };

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Ada");
  git("config", "user.email", "ada@example.com");
  git("config", "commit.gpgsign", "false");
  await writeFile(join(workspace, "a.txt"), "one\ntwo\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");

  return root;
}
