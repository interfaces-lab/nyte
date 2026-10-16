import { spawn } from "node:child_process";
import { mkdir, open, readFile, stat } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import { scheduler } from "node:timers/promises";
import { ConnectViewSchema } from "@nyte-ai/connect";
import type { ConnectView } from "@nyte-ai/connect";
import { HOST_HEADER } from "@nyte-ai/protocol";
import { Value } from "typebox/value";
import { alive, lockHolder, logPath, readRegistration } from "./registration.ts";
import type { Registration } from "./registration.ts";
import { SERVICE_ROUTES, ServiceEventSchema } from "./routes.ts";
import type { ServiceEvent } from "./routes.ts";

const START_TIMEOUT_MS = 20_000;

const STOP_TIMEOUT_MS = 5_000;

const POLL_MS = 50;

export interface EnsureServiceOptions {
  readonly home: string;
  readonly version: string;
  readonly command: readonly [string, ...string[]];
}

export async function findService(home: string): Promise<Registration | undefined> {
  const registration = await readRegistration(home);

  if (registration === undefined) return undefined;

  return (await answers(registration)) ? registration : undefined;
}

export async function ensureService(options: EnsureServiceOptions): Promise<Registration> {
  const found = await findService(options.home);

  if (found?.version === options.version) return found;

  if (found !== undefined) await stopService(options.home);

  return start(options);
}

export async function stopService(home: string): Promise<boolean> {
  const pid = (await findService(home))?.pid ?? (await lockHolder(home));

  if (pid === undefined) return false;

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return false;
  }

  const deadline = Date.now() + STOP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (!alive(pid)) return true;
    await scheduler.wait(POLL_MS);
  }

  throw new Error(
    `The Nyte service (pid ${String(pid)}) didn't stop within 5 s. Stop it with \`kill ${String(pid)}\`.`,
  );
}

async function start(options: EnsureServiceOptions): Promise<Registration> {
  const log = logPath(options.home);
  await mkdir(dirname(log), { recursive: true, mode: 0o700 });
  const offset = (await stat(log).catch(() => undefined))?.size ?? 0;
  const output = await open(log, "a", 0o600);
  const [command, ...args] = options.command;

  const child = spawn(command, args, {
    cwd: options.home,
    detached: true,
    stdio: ["ignore", output.fd, output.fd],
  });

  child.unref();
  await output.close();

  const exited = new Promise<void>((settle) => {
    child.once("exit", () => settle());
    child.once("error", () => settle());
  });

  let gone = false;
  void exited.then(() => {
    gone = true;
  });

  const deadline = Date.now() + START_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const exitedBefore = gone;
    const found = await findService(options.home);

    if (found?.version === options.version) return found;

    if (exitedBefore && (await lockHolder(options.home)) === undefined)
      throw new Error(`${await failureIn(log, offset)} See ${log}.`);
    await scheduler.wait(POLL_MS);
  }

  throw new Error(`The Nyte service didn't start within 20 s. See ${log}.`);
}

async function failureIn(log: string, offset: number): Promise<string> {
  const text = await readFile(log, "utf8").catch(() => "");
  const lines = text.slice(offset).split("\n");
  const error = lines.findLast((line) => line.startsWith("error: "));

  return error === undefined
    ? "The Nyte service exited before it was ready."
    : error.slice("error: ".length);
}

async function answers(registration: Registration): Promise<boolean> {
  if (!alive(registration.pid)) return false;

  const hostId = await fetch(new URL("/.nyte/describe", registration.url), {
    signal: AbortSignal.timeout(1000),
  })
    .then((response) => response.headers.get(HOST_HEADER))
    .catch(() => null);

  return hostId === registration.hostId;
}


export interface ServiceConnect {
  view(): Promise<ConnectView>;
  watch(signal: AbortSignal): AsyncIterable<ServiceEvent>;
  share(signal: AbortSignal): AsyncIterable<ServiceEvent>;
  unlink(): Promise<ConnectView>;
}

export function serviceConnect(registration: Registration): ServiceConnect {
  const headers = { Authorization: `Bearer ${registration.token}` };
  const url = (path: string): URL => new URL(path, registration.url);

  const readView = async (response: Response): Promise<ConnectView> => {
    const body: unknown = await response.json();

    if (!response.ok)
      throw new Error(
        typeof body === "object" && body !== null && "message" in body
          ? String(body.message)
          : `The Nyte service answered ${String(response.status)}.`,
      );

    return Value.Parse(ConnectViewSchema, body);
  };

  return {
    view: async () => readView(await fetch(url(SERVICE_ROUTES.connect), { headers })),
    watch: (signal) => events(url(SERVICE_ROUTES.watch), headers, signal),
    share: (signal) => events(url(SERVICE_ROUTES.share), headers, signal),
    unlink: async () =>
      readView(await fetch(url(SERVICE_ROUTES.unlink), { method: "POST", headers })),
  };
}

async function* events(
  url: URL,
  headers: Readonly<Record<string, string>>,
  signal: AbortSignal,
): AsyncIterable<ServiceEvent> {
  const response = await fetch(url, { headers, signal });

  if (!response.ok || response.body === null)
    throw new Error(`The Nyte service answered ${String(response.status)}.`);
  const decoder = new TextDecoder();
  let buffered = "";

  try {
    for await (const chunk of response.body) {
      buffered += decoder.decode(chunk, { stream: true });
      let newline = buffered.indexOf("\n");

      while (newline !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);

        if (line !== "") yield Value.Parse(ServiceEventSchema, JSON.parse(line));
        newline = buffered.indexOf("\n");
      }
    }
  } catch (cause) {
    if (signal.aborted) return;

    throw cause;
  }
}
