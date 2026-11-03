import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { Type } from "typebox";
import { asId, compile, SdkError, TailnetSettingsType, TailnetStatusType } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import type { Authority, TailnetSettings, TailnetStatus } from "@nyte-ai/schema";
import { dev } from "@nyte-ai/core";
import { TOKEN_AUTHORITY } from "@nyte-ai/core/server";
import type { ServedHost, Verdict } from "@nyte-ai/core/server";
import type { OperationInput } from "@nyte-ai/protocol";
import { listenFetch } from "./listen-fetch.ts";
import { serveSocket } from "./listen.ts";
import { readErrorCode } from "./local/tree.ts";

export interface TailnetControl {
  status(): TailnetStatus;
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

const PARTICIPANT: ReadonlySet<Authority> = new Set<Authority>(["participant"]);

const settingsCheck = compile(TailnetSettingsType);

const statusCheck = compile(TailnetStatusType);

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

  const publish = (status: TailnetStatus): void => {
    current = status;
    server.reportTailnet(status);
  };

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
        ...(authKey === undefined ? [] : ["--auth-key-fd", "0"]),
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    node = started;
    started.stdin.on("error", () => undefined);
    started.stdin.end(authKey ?? "");
    publish({ state: "starting", https: "pending", access: settings.access, tags: settings.tags });

    createInterface({ input: started.stdout }).on("line", (line) => {
      const status = readStatus(line);

      if (node !== started || status === null) return;

      if (status.state === "running") failures = 0;
      publish(status);
    });

    createInterface({ input: started.stderr }).on("line", (line) => {
      dev("tailnet", "node", { line });
    });

    const ended = (): void => {
      if (node !== started) return;
      node = null;
      publish({
        state: "stopped",
        https: "unavailable",
        access: settings.access,
        tags: settings.tags,
      });
      scheduleRestart();
    };

    started.once("exit", ended);
    started.once("error", (error) => {
      dev("tailnet", "node failed", { error: error.message });
      ended();
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
