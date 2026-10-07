/**
 * Fixtures for the registry journeys. The built app is served by
 * `app-server.ts`, which the config starts and names as `baseURL`; each test
 * gets a machine of its own (a temp `HOME` with seeded folders) and starts
 * real hosts on it. Requests that leave loopback are refused and fail the test.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { expect, test as base } from "@playwright/test";
import type { TestInfo } from "@playwright/test";
import { Value } from "typebox/value";
import { collectErrors } from "../utils/errors.ts";
import type { PageProblems } from "../utils/errors.ts";
import { Ready, StateReply } from "./control.ts";
import type { HostState } from "./control.ts";

const HOST_SCRIPT = join(import.meta.dirname, "host.ts");

const READY_MS = 30_000;

const STATE_MS = 10_000;

const STOP_MS = 15_000;

export const README_LINE = "Read from the host through the browser.";

export interface RegistryHost {
  readonly address: string;
  readonly token: string;
  readonly hostId: string;
  /** This host's `NYTE_HOME`: its profile, bearer, registry and history. */
  readonly home: string;
  /** What the runtime holds now, read in the host process. */
  state(): Promise<HostState>;
  /** Close the host's stdin and require a clean exit. Idempotent. */
  stop(): Promise<void>;
}

export interface Hosts {
  /** Folders on this test's machine: each carries project input (`.nyte/plugins`) and a README. */
  readonly folders: { readonly project: string; readonly other: string };
  /** A host on this machine; `home` reopens a stopped host's profile, `port` binds a fixed port. */
  start(options?: { readonly home?: string; readonly port?: number }): Promise<RegistryHost>;
}

/** `work`, or a rejection naming `what` once `ms` pass. */
async function within<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  const timer = new AbortController();

  const expired = delay(ms, undefined, { signal: timer.signal }).then(() => {
    throw new Error(`${what} took longer than ${String(ms)} ms`);
  });

  expired.catch(() => undefined);

  try {
    return await Promise.race([work, expired]);
  } finally {
    timer.abort();
  }
}

async function seedFolder(path: string, readme: string): Promise<void> {
  await mkdir(join(path, ".nyte", "plugins"), { recursive: true });
  await writeFile(join(path, "README.md"), readme);
}

async function startHost(input: {
  readonly appOrigin: string;
  readonly machine: string;
  readonly home: string;
  readonly port: number;
  readonly index: number;
  readonly testInfo: TestInfo;
  readonly defer: (cleanup: () => Promise<void>) => void;
}): Promise<RegistryHost> {
  const { machine, home } = input;
  const user = join(machine, "home");

  const env = {
    PATH: process.env.PATH ?? "",
    HOME: user,
    NYTE_HOME: home,
    CLAUDE_CONFIG_DIR: join(user, ".claude"),
    CODEX_HOME: join(user, ".codex"),
    XDG_CONFIG_HOME: join(user, ".config"),
    GH_CONFIG_DIR: join(user, ".config", "gh"),
    TMPDIR: tmpdir(),
  };

  const child = spawn(
    process.execPath,
    [HOST_SCRIPT, "--origin", input.appOrigin, "--port", String(input.port)],
    { cwd: machine, env, stdio: ["pipe", "pipe", "pipe"] },
  );

  const log: string[] = [];
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => log.push(chunk));

  const exit = new Promise<string>((resolve) => {
    child.once("exit", (code, signal) => resolve(code === null ? String(signal) : `exit ${code}`));
  });

  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();

  const nextLine = async (what: string, ms: number): Promise<string> => {
    const next = await within(
      ms,
      what,
      Promise.race([lines.next(), exit.then(() => ({ done: true as const, value: undefined }))]),
    );

    if (next.done === true) throw new Error(`The host stopped before ${what}.\n${log.join("")}`);

    return next.value;
  };

  let stopping: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      child.stdin.end();
      let status: string;

      try {
        status = await within(STOP_MS, "stopping the host", exit);
      } catch (cause) {
        child.kill("SIGKILL");
        await exit;
        throw cause;
      }

      if (status !== "exit 0") throw new Error(`The host closed with ${status}.\n${log.join("")}`);
    })();

    return stopping;
  };

  input.defer(async () => {
    try {
      await stop();
    } finally {
      await input.testInfo.attach(`host-${String(input.index)}.log`, {
        body: log.join(""),
        contentType: "text/plain",
      });
    }
  });

  const ready: unknown = JSON.parse(await nextLine("its ready line", READY_MS));

  if (!Value.Check(Ready, ready)) throw new Error(`Not a ready line: ${JSON.stringify(ready)}`);

  let sequence = 0;
  let asking: Promise<unknown> = Promise.resolve();

  const state = (): Promise<HostState> => {
    sequence += 1;
    const id = sequence;

    const asked = asking.then(async () => {
      child.stdin.write(`${JSON.stringify({ id, kind: "state" })}\n`);
      const reply: unknown = JSON.parse(await nextLine(`state ${String(id)}`, STATE_MS));

      if (!Value.Check(StateReply, reply))
        throw new Error(`Not a state reply: ${JSON.stringify(reply)}`);

      if (reply.kind === "error") throw new Error(reply.message);

      if (reply.id !== id) throw new Error(`State ${String(id)} answered as ${String(reply.id)}`);

      return reply;
    });

    asking = asked.catch(() => undefined);

    return asked;
  };

  return { address: ready.address, token: ready.token, hostId: ready.hostId, home, state, stop };
}

export const test = base.extend<{
  hosts: Hosts;
  problems: PageProblems;
  external: readonly string[];
}>({
  external: [
    async ({ context }, provide) => {
      const attempted: string[] = [];

      await context.route(
        (url) => url.hostname !== "127.0.0.1",
        (route) => {
          attempted.push(route.request().url());

          return route.abort("blockedbyclient");
        },
      );

      await provide(attempted);
      expect(attempted, "the journey must not leave loopback").toEqual([]);
    },
    { auto: true },
  ],

  problems: async ({ page }, provide) => {
    await provide(collectErrors(page));
  },

  hosts: async ({ baseURL }, provide, testInfo) => {
    if (baseURL === undefined)
      throw new Error("Run with --config e2e/registry.config.ts; it serves the built app");
    await using cleanup = new AsyncDisposableStack();
    const machine = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-registry-")));
    cleanup.defer(() => rm(machine, { recursive: true, force: true }));

    const folders = {
      project: join(machine, "code", "project"),
      other: join(machine, "code", "other"),
    };

    await seedFolder(folders.project, `# Project\n\n${README_LINE}\n`);
    await seedFolder(folders.other, "# Other\n");
    await mkdir(join(machine, "home"));
    let started = 0;

    await provide({
      folders,
      start: async (options) => {
        started += 1;

        return startHost({
          appOrigin: baseURL,
          machine,
          home: options?.home ?? join(machine, `nyte-${String(started)}`),
          port: options?.port ?? 0,
          index: started,
          testInfo,
          defer: (step) => cleanup.defer(step),
        });
      },
    });
  },
});

export { expect };
