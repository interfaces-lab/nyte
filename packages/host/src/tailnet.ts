import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { Type } from "typebox";
import { asId, compile, SdkError, TailnetSettingsType, TailnetStatusType } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import type { Authority, TailnetSettings, TailnetStatus } from "@nyte-ai/schema";
import { TOKEN_AUTHORITY } from "@nyte-ai/core/server";
import type { ServedHost, Verdict } from "@nyte-ai/core/server";
import type { OperationInput } from "@nyte-ai/protocol";
import { listenFetch } from "./listen-fetch.ts";
import { serveSocket } from "./listen.ts";
import { readErrorCode } from "./local/tree.ts";

export interface TailnetControl {
  status(): TailnetStatus;
  subscribe(listener: (status: TailnetStatus) => void): () => void;
  configure(input: OperationInput<"host.tailnet.configure">): Promise<TailnetStatus>;
  logout(): Promise<TailnetStatus>;
  close(): Promise<void>;
}

const TAILNET_PRINCIPAL_HEADER = "X-Nyte-Tailnet-Principal";

const DEFAULT_SETTINGS: TailnetSettings = {
  enabled: false,
  hostname: "nyte",
  tags: [],
  access: "owner",
};

const FIRST_RESTART_MS = 1_000;

const LAST_RESTART_MS = 30_000;

const STOP_GRACE_MS = 10_000;

const PROTOCOL = 1;

const HELLO_MS = 10_000;

const READY_MS = 120_000;

const STDERR_TAIL_BYTES = 4096;

const PARTICIPANT: ReadonlySet<Authority> = new Set<Authority>(["participant"]);

const settingsCheck = compile(TailnetSettingsType);

const statusCheck = compile(TailnetStatusType);

const helloCheck = compile(
  Type.Object({ type: Type.Literal("hello"), protocol: Type.Number(), version: Type.String() }),
);

const principalCheck = compile(
  Type.Object({
    kind: Type.Literal("tailscale"),
    userId: Type.String(),
    loginName: Type.String(),
    node: Type.String(),
    tags: Type.Array(Type.String()),
    owner: Type.Boolean(),
  }),
);

type Ending = { readonly status: TailnetStatus; readonly restart: boolean };

export async function openTailnet(options: {
  readonly host: ServedHost;
  readonly home: string;
  readonly binary: string;
}): Promise<TailnetControl> {
  const folder = join(options.home, ".nyte");
  const settingsPath = join(folder, "tailnet.json");
  const stateDir = join(folder, "tailnet");
  const socket = join(folder, "tailnet.sock");
  const server = options.host.server;
  const changes = serial();
  let settings = await readSettings(settingsPath, options.host);
  let current: TailnetStatus = disabled(settings);
  let node: ChildProcess | null = null;
  let restart: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let route: { close(): Promise<void> } | null = null;
  let closed = false;
  const listeners = new Set<(status: TailnetStatus) => void>();

  const publish = (status: TailnetStatus): void => {
    current = status;
    server.reportTailnet(status);

    for (const listener of listeners) listener(status);
  };

  const stopped = (
    reason: NonNullable<TailnetStatus["reason"]>,
    detail: string,
  ): TailnetStatus => ({
    state: "stopped",
    https: "unavailable",
    access: settings.access,
    tags: settings.tags,
    reason,
    detail,
  });

  const authorize = (request: Request): Verdict | { readonly deny: "unauthorized" } => {
    const principal = readPrincipal(request.headers.get(TAILNET_PRINCIPAL_HEADER));

    if (principal === null) return { deny: "unauthorized" };

    return {
      principal: asId<"principal">(
        principal.tags.length > 0
          ? `tailscale:node:${principal.node}`
          : `tailscale:user:${principal.userId}`,
      ),
      authority: principal.owner ? TOKEN_AUTHORITY : PARTICIPANT,
    };
  };

  const openRoute = async (): Promise<void> => {
    if (route !== null) return;

    const listener = await listenFetch(options.host, {
      transport: { kind: "fetch" },
      auth: { kind: "custom", authorize },
      execution: { kind: "admit-only" },
    });

    const served = await serveSocket(
      socket,
      (request) => listener.fetch(withoutCredentials(request)),
      "https",
      (request) => listener.admit(withoutCredentials(request)),
    ).catch(async (error: unknown) => {
      await listener.close();

      throw error;
    });

    route = {
      async close() {
        served.disconnect();
        await listener.close();
        await served.close();
      },
    };
  };

  const start = (authKey: string | undefined): void => {
    const started = spawn(
      options.binary,
      [
        "--dir",
        stateDir,
        "--socket",
        socket,
        "--hostname",
        settings.hostname,
        "--access",
        settings.access,
        ...settings.tags.flatMap((tag) => ["--tag", tag]),
        ...(authKey === undefined ? [] : ["--auth-key-fd", "3"]),
      ],
      { stdio: ["pipe", "pipe", "pipe", "pipe"] },
    );

    const keyPipe = started.stdio[3];
    let greeted = false;
    let stderr = Buffer.alloc(0);
    let ending: Ending | null = null;

    node = started;
    started.stdin.on("error", () => undefined);

    if (keyPipe instanceof Writable) {
      keyPipe.on("error", () => undefined);
      keyPipe.end(authKey ?? "");
    }

    publish({ state: "starting", https: "pending", access: settings.access, tags: settings.tags });

    const fail = (
      reason: NonNullable<TailnetStatus["reason"]>,
      detail: string,
      restart: boolean,
    ): void => {
      ending ??= { status: stopped(reason, detail), restart };
      void terminate(started);
    };

    const helloTimer = setTimeout(
      () =>
        fail(
          "hello_timeout",
          `nyte-tailnet sent no hello within ${String(HELLO_MS / 1000)} s.`,
          true,
        ),
      HELLO_MS,
    );

    const readyTimer = setTimeout(
      () =>
        fail(
          "start_timeout",
          `nyte-tailnet didn't reach running or ask for a login within ${String(READY_MS / 1000)} s.`,
          true,
        ),
      READY_MS,
    );

    helloTimer.unref();
    readyTimer.unref();

    const greet = (line: string): void => {
      const hello = parseJson(line);

      if (!helloCheck.Check(hello)) {
        logSidecar(`nyte-tailnet began with ${line} instead of a hello`);
        fail("invalid_status", "nyte-tailnet's first line wasn't a hello.", true);

        return;
      }

      if (hello.protocol !== PROTOCOL) {
        fail(
          "protocol",
          `nyte-tailnet ${hello.version} speaks protocol ${String(hello.protocol)}, but this host speaks ${String(PROTOCOL)}.`,
          false,
        );

        return;
      }

      greeted = true;
      clearTimeout(helloTimer);
    };

    createInterface({ input: started.stdout }).on("line", (line) => {
      if (node !== started || ending !== null) return;

      if (!greeted) {
        greet(line);

        return;
      }

      const status = readStatus(line);

      if (status === null) {
        logSidecar(`nyte-tailnet sent a status the host can't read: ${line}`);
        fail("invalid_status", "nyte-tailnet sent a status the host can't read.", true);

        return;
      }

      if (status.state !== "starting") clearTimeout(readyTimer);

      if (status.state === "running") failures = 0;

      if (status.state === "stopped" && status.reason !== undefined)
        ending = { status: { ...status, https: "unavailable" }, restart: true };
      publish(status);
    });

    createInterface({ input: started.stderr }).on("line", (line) => {
      logSidecar(line);
    });

    started.stderr.on("data", (chunk: Buffer) => {
      stderr = Buffer.concat([stderr, chunk]).subarray(-STDERR_TAIL_BYTES);
    });

    const ended = (detail: string): void => {
      clearTimeout(helloTimer);
      clearTimeout(readyTimer);

      if (node !== started) return;
      node = null;
      const stop = ending ?? { status: stopped("exited", detail), restart: true };
      const tail = stderr.toString("utf8");

      publish(tail === "" ? stop.status : { ...stop.status, stderr: tail });

      if (stop.restart) scheduleRestart();
    };

    started.once("close", (code, signal) => {
      ended(`nyte-tailnet exited with ${signal ?? `code ${String(code)}`}.`);
    });
    started.once("error", (error) => {
      ended(`nyte-tailnet couldn't run: ${error.message}`);
    });
  };

  const scheduleRestart = (): void => {
    const delay = Math.min(FIRST_RESTART_MS * 2 ** failures, LAST_RESTART_MS);
    failures += 1;
    restart = setTimeout(() => {
      restart = null;

      if (!closed && settings.enabled && node === null) start(undefined);
    }, delay);
    restart.unref();
  };

  const stop = async (): Promise<void> => {
    if (restart !== null) clearTimeout(restart);
    restart = null;
    const running = node;
    node = null;

    if (running !== null) await terminate(running);
  };

  const apply = async (authKey: string | undefined): Promise<void> => {
    await stop();
    failures = 0;

    if (!settings.enabled) {
      publish(disabled(settings));

      return;
    }

    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await openRoute();
    start(authKey);
  };

  const save = async (next: TailnetSettings): Promise<void> => {
    await mkdir(folder, { recursive: true, mode: 0o700 });
    const staged = `${settingsPath}.${process.pid}.tmp`;
    await writeFile(staged, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    await rename(staged, settingsPath);
    settings = next;
  };

  await apply(undefined);

  return {
    status: () => current,

    subscribe(listener) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },

    configure: (input) =>
      changes.run(async () => {
        if (input.access === "owner" && input.tags.length > 0)
          throw new SdkError("invalid", "A tagged node has no owner, so tags need access tailnet.");

        await save({
          enabled: input.enabled,
          hostname: input.hostname,
          tags: [...input.tags],
          access: input.access,
        });
        await apply(input.authKey);

        return current;
      }),

    logout: () =>
      changes.run(async () => {
        await stop();
        const signedOut = await runOnce(options.binary, ["--dir", stateDir, "--logout"]);
        await save({ ...settings, enabled: false });
        await apply(undefined);

        if (!signedOut)
          throw new SdkError(
            "unavailable",
            "The tailnet node is off but couldn't sign out. Try again.",
          );

        return current;
      }),

    close: () =>
      changes.run(async () => {
        closed = true;
        await stop();
        await route?.close();
        route = null;
      }),
  };
}

async function readSettings(path: string, host: ServedHost): Promise<TailnetSettings> {
  const text = await readFile(path, "utf8").catch((error: unknown) => {
    if (readErrorCode(error) === "ENOENT") return null;

    throw error;
  });

  if (text === null) return DEFAULT_SETTINGS;
  const value = parseJson(text);

  if (settingsCheck.Check(value)) return value;
  host.server.report({
    id: "tailnet",
    source: "user",
    path,
    issues: [
      {
        severity: "warning",
        path: [],
        message: `${path} isn't valid tailnet settings, so the tailnet node stays off.`,
      },
    ],
  });

  return DEFAULT_SETTINGS;
}

function disabled(settings: TailnetSettings): TailnetStatus {
  return { state: "disabled", https: "unavailable", access: settings.access, tags: settings.tags };
}

function readStatus(line: string): TailnetStatus | null {
  const value = parseJson(line);

  return statusCheck.Check(value) ? value : null;
}

function readPrincipal(header: string | null) {
  if (header === null) return null;
  const value = parseJson(Buffer.from(header, "base64url").toString("utf8"));

  return principalCheck.Check(value) ? value : null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function withoutCredentials(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete("Authorization");

  return new Request(request, { headers });
}

function logSidecar(line: string): void {
  process.emitWarning(line, { code: "NYTE_TAILNET" });
}

function terminate(running: ChildProcess): Promise<void> {
  if (running.pid === undefined || running.exitCode !== null || running.signalCode !== null)
    return Promise.resolve();

  return new Promise<void>((done) => {
    const timer = setTimeout(() => running.kill("SIGKILL"), STOP_GRACE_MS);
    running.once("exit", () => {
      clearTimeout(timer);
      done();
    });
    running.kill("SIGTERM");
  });
}

function runOnce(binary: string, args: readonly string[]): Promise<boolean> {
  return new Promise<boolean>((done) => {
    const running = spawn(binary, args, { stdio: "ignore" });
    running.once("error", () => done(false));
    running.once("exit", (code) => done(code === 0));
  });
}
