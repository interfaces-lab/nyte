import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { HOST_HEADER } from "@nyte-ai/protocol";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const RunningHostType = Type.Object({
  url: Type.String(),
  token: Type.String(),
  pid: Type.Integer(),
  socket: Type.Optional(Type.String()),
});

/** What `nyte host` writes to `host.json` while it serves: where it listens, its token, its process and its local socket. */
export type RunningHost = Static<typeof RunningHostType>;

const HostAddressType = Type.Object({ port: Type.Integer(), token: Type.String() });

export type HostAddress = Static<typeof HostAddressType>;

export function hostFilePath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "host.json");
}

/** The lock that elects the one served host for this home; the store itself stays shared. */
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

/** The host's own record of the failures that can leave a run stuck. `host.log` can be launchd's stdout, which the host cannot rotate, so this is a separate file. */
export function hostFaultsPath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "logs", "host-faults.log");
}

export function hostDocsPath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "docs");
}

export function hostRetirePath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(hostStateDirectory(env), "retire");
}

function hostStateDirectory(env: Readonly<Record<string, string | undefined>>): string {
  return env["NYTE_HOME"] ?? join(homedir(), ".nyte");
}

/** The host `path` names when its process is alive and its URL answers; `null` when there is none or it is stale. */
export async function findRunningHost(path: string): Promise<RunningHost | null> {
  const host = await readHostFile(path);

  if (host === null || !processAlive(host.pid)) return null;

  return (await hostAnswers(host.url)) ? host : null;
}

/** Whether a Nyte host, one that names itself in its host header, answers at `url` within a second. */
export async function hostAnswers(url: string): Promise<boolean> {
  return fetch(new URL("/.nyte/describe", url), { signal: AbortSignal.timeout(1_000) }).then(
    async (response) => {
      await response.body?.cancel();

      return response.headers.has(HOST_HEADER);
    },
    () => false,
  );
}

/**
 * Makes `path` name `host`, readable only by this user, replacing whatever it held. Only the holder
 * of the host lock calls it, after finding no live host in the file, so a pid or port the file
 * still names belongs to no host. Readers see the old file or the new one, never a partial one.
 */
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

/** Removes `path` if it still names process `pid`. */
export async function withdrawHost(path: string, pid: number): Promise<void> {
  if ((await readHostFile(path))?.pid === pid) await rm(path, { force: true });
}

/** The host `path` names, or `null` when it is missing, empty or not a host file. */
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
