import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

/** What a running service writes to `~/.nyte/service.json`: where it listens, its token, pid and host id, and `version`, the build identity `serviceBuild` returns, which a client compares with its own. */
export const Registration = Type.Object({
  url: Type.String(),
  token: Type.String({ minLength: 16 }),
  pid: Type.Integer({ minimum: 1 }),
  version: Type.String(),
  hostId: Type.String(),
});

export type Registration = Static<typeof Registration>;

export function registrationPath(home: string): string {
  return join(home, ".nyte", "service.json");
}

export type ServiceLock =
  | { readonly kind: "acquired"; release(): Promise<void> }
  | { readonly kind: "held"; readonly pid: number };

export async function acquireLock(home: string, pid: number): Promise<ServiceLock> {
  const path = lockPath(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, `${String(pid)}\n`, { flag: "wx", mode: 0o600 });

      return {
        kind: "acquired",
        release: async () => {
          if ((await lockPid(path)) === pid) await rm(path, { force: true });
        },
      };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      const holder = await lockPid(path);

      if (holder !== undefined && alive(holder)) return { kind: "held", pid: holder };
      await rm(path, { force: true });
    }
  }

  return { kind: "held", pid: (await lockPid(path)) ?? 0 };
}

async function lockPid(path: string): Promise<number | undefined> {
  const text = await readFile(path, "utf8").catch(() => undefined);
  const pid = Number(text?.trim());

  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export async function lockHolder(home: string): Promise<number | undefined> {
  const pid = await lockPid(lockPath(home));

  return pid !== undefined && alive(pid) ? pid : undefined;
}

function lockPath(home: string): string {
  return join(home, ".nyte", "service.lock");
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
}

export function logPath(home: string): string {
  return join(home, ".nyte", "logs", "service.log");
}

export async function readRegistration(home: string): Promise<Registration | undefined> {
  const text = await readFile(registrationPath(home), "utf8").catch(() => undefined);

  if (text === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(text);

    return Value.Check(Registration, parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export async function writeRegistration(home: string, registration: Registration): Promise<void> {
  const path = registrationPath(home);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporary, `${JSON.stringify(registration)}\n`, { mode: 0o600 });
    await rename(temporary, path);
  } catch (cause) {
    await rm(temporary, { force: true });

    throw cause;
  }
}

export async function removeRegistration(home: string, pid: number): Promise<void> {
  const current = await readRegistration(home);

  if (current?.pid === pid) await rm(registrationPath(home), { force: true });
}
