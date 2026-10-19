import { readFile, realpath } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { makeHome, print, seed } from "./builds.ts";
import type { Build, Home } from "./builds.ts";
import { serveModel } from "./model-server.ts";
import type { ModelServer } from "./model-server.ts";

export interface World extends AsyncDisposable {
  readonly model: ModelServer;
  readonly home: Home;
  readonly parent: string;
  defer(dispose: () => unknown): void;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

export async function registeredPids(home: Home): Promise<readonly number[]> {
  const files = ["service.lock", "service.json", "desktop.json", "serve.json"];

  const found = await Promise.all(
    files.map(async (file) => {
      const text = await readFile(join(home.home, ".nyte", file), "utf8").catch(() => "");

      const pid = file.endsWith(".lock")
        ? Number(text.trim())
        : Number(/"pid":(\d+)/u.exec(text)?.[1]);

      return Number.isInteger(pid) && pid > 0 ? [pid] : [];
    }),
  );

  return found.flat();
}

export async function world(
  name: string,
  seeder: Build,
  options: { readonly audit?: boolean } = {},
): Promise<World> {
  const parent = await realpath(await mkdtemp(join(tmpdir(), `nyte-stores-${name}-`)));
  const model = await serveModel();
  const made = await makeHome(parent, model);

  const home =
    options.audit === true ? { ...made, env: { ...made.env, NYTE_STORE_AUDIT: "1" } } : made;

  await seed(seeder, home);
  const disposers: (() => unknown)[] = [];

  return {
    model,
    home,
    parent,
    defer: (dispose) => void disposers.push(dispose),
    async [Symbol.asyncDispose]() {
      for (const dispose of disposers.reverse())
        await Promise.resolve(dispose()).catch(() => undefined);

      for (const pid of await registeredPids(home)) if (alive(pid)) process.kill(pid, "SIGKILL");
      await model[Symbol.asyncDispose]();
    },
  };
}

export async function startChat(build: Build, home: Home, text: string): Promise<string> {
  const ran = await print(build, home, [text]).exited;
  const session = /session (\S+) ·/u.exec(`${ran.stdout}${ran.stderr}`)?.[1];

  if (ran.code !== 0 || session === undefined)
    throw new Error(`${build.label} could not start a chat:\n${ran.stdout}${ran.stderr}`);

  return session;
}

export async function eventually<T>(
  what: string,
  check: () => T | null | undefined | Promise<T | null | undefined>,
  timeoutMs: number,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  let last: unknown;

  while (performance.now() < deadline) {
    try {
      const value = await check();

      if (value !== null && value !== undefined && value !== false) return value;
    } catch (cause) {
      last = cause;
    }

    await sleep(100);
  }

  throw new Error(
    `${what} did not happen within ${String(timeoutMs)} ms${last === undefined ? "" : `: ${last instanceof Error ? last.message : JSON.stringify(last)}`}`,
  );
}

export function bashTool(command: string): string {
  return `TOOL bash ${JSON.stringify({ command, description: "harness" })}`;
}
