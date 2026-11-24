import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { HOST_HEADER } from "@nyte-ai/protocol";
import { HostDescriptionType } from "@nyte-ai/schema";
import type { HostDescription } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const RunningHostType = Type.Object({
  url: Type.String(),
  token: Type.String(),
  pid: Type.Integer(),
  socket: Type.Optional(Type.String()),
});

export type RunningHost = Static<typeof RunningHostType>;

const HostAddressType = Type.Object({ port: Type.Integer(), token: Type.String() });

export type HostAddress = Static<typeof HostAddressType>;

export function hostFilePath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "host.json");
}

export function hostLockPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return join(hostStateDirectory(env), "host.lock");
}

export function hostSocketPath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "host.sock");
}

export function hostLogPath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "logs", "host.log");
}

export function hostFaultsPath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "logs", "host-faults.log");
}

export function hostDocsPath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "docs");
}

export function hostMetricsPath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "metrics");
}

function hostStateDirectory(env: Readonly<Record<string, string | undefined>>): string {
  return env["NYTE_HOME"] ?? join(homedir(), ".nyte");
}

export async function findRunningHost(path: string): Promise<RunningHost | null> {
  const host = await readHostFile(path);

  if (host === null || !processAlive(host.pid)) return null;

  return (await hostAnswers(host.url)) ? host : null;
}

export async function hostAnswers(url: string): Promise<boolean> {
  return fetch(new URL("/.nyte/describe", url), { signal: AbortSignal.timeout(1000) }).then(
    async (response) => {
      await response.body?.cancel();

      return response.headers.has(HOST_HEADER);
    },
    () => false,
  );
}

/** Reads what a host says about itself, without credentials. Null when it doesn't answer in `ms` or answers something else. */
export async function describeHost(url: string, ms: number): Promise<HostDescription | null> {
  const body: unknown = await fetch(new URL("/.nyte/describe", url), {
    signal: AbortSignal.timeout(ms),
  })
    .then((response) => response.json())
    .catch(() => null);

  return Value.Check(HostDescriptionType, body) ? body : null;
}

export async function publishHost(path: string, host: RunningHost): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const draft = `${path}.tmp`;
  await writeFile(draft, `${JSON.stringify(host)}\n`, { mode: 0o600 });
  await rename(draft, path);
}

export async function readHostAddress(path: string): Promise<HostAddress | null> {
  const parsed = await readJson(path);

  return Value.Check(HostAddressType, parsed) ? parsed : null;
}

export async function saveHostAddress(path: string, address: HostAddress): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(address)}\n`, { mode: 0o600 });
}

export async function withdrawHost(path: string, pid: number): Promise<void> {
  if ((await readHostFile(path))?.pid === pid) await rm(path, { force: true });
}

export async function readHostFile(path: string): Promise<RunningHost | null> {
  const parsed = await readJson(path);

  return Value.Check(RunningHostType, parsed) ? parsed : null;
}

async function readJson(path: string): Promise<unknown> {
  const text = await readFile(path, "utf8").catch(() => null);

  if (text === null) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM";
  }
}
