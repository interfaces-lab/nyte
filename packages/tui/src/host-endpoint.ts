import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";

const RunningHostType = Type.Object({
  url: Type.String(),
  token: Type.String(),
  pid: Type.Integer(),
});

/** What `nyte host` writes to `host.json` while it serves: where it listens, its token and its process. */
export type RunningHost = Static<typeof RunningHostType>;

const runningHosts = Compile(RunningHostType);

export type Published =
  | { readonly kind: "published" }
  | { readonly kind: "taken"; readonly by: RunningHost };

export function hostFilePath(env: Readonly<Record<string, string | undefined>> = process.env) {
  return join(env["NYTE_HOME"] ?? join(homedir(), ".nyte"), "host.json");
}

/** The host `path` names when its process is alive and its URL answers; `null` when there is none or it is stale. */
export async function findRunningHost(path: string): Promise<RunningHost | null> {
  const host = await readHostFile(path);

  if (host === null || !processAlive(host.pid)) return null;

  return (await hostAnswers(host.url)) ? host : null;
}

/** Whether anything answers HTTP at `url` within a second. */
export async function hostAnswers(url: string): Promise<boolean> {
  return fetch(new URL("/.nyte/describe", url), { signal: AbortSignal.timeout(1_000) }).then(
    async (response) => {
      await response.body?.cancel();

      return true;
    },
    () => false,
  );
}

/** Creates `path` readable only by this user, naming `host`, unless a live host already holds it; a stale file is replaced. */
export async function publishHost(path: string, host: RunningHost): Promise<Published> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  for (let attempt = 0; ; attempt++) {
    try {
      await writeFile(path, `${JSON.stringify(host)}\n`, { flag: "wx", mode: 0o600 });

      return { kind: "published" };
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST") || attempt > 0)
        throw cause;
    }

    const holder = await findRunningHost(path);

    if (holder !== null) return { kind: "taken", by: holder };
    await rm(path, { force: true });
  }
}

/** Removes `path` if it still names process `pid`. */
export async function withdrawHost(path: string, pid: number): Promise<void> {
  if ((await readHostFile(path))?.pid === pid) await rm(path, { force: true });
}

async function readHostFile(path: string): Promise<RunningHost | null> {
  const text = await readFile(path, "utf8").catch(() => null);

  if (text === null) return null;
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  return runningHosts.Check(parsed) ? parsed : null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (cause) {
    return cause instanceof Error && "code" in cause && cause.code === "EPERM";
  }
}
