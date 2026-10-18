import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { readStoreOwner } from "./store-owner.ts";

const Endpoint = {
  url: Type.String(),
  token: Type.String({ minLength: 16 }),
  pid: Type.Integer({ minimum: 1 }),
  version: Type.String(),
  hostId: Type.String(),
};

export const Registration = Type.Union([
  Type.Object({ ...Endpoint, owner: Type.Optional(Type.Literal("service")) }),
  Type.Object({ ...Endpoint, owner: Type.Literal("desktop"), operations: Type.String() }),
  Type.Object({ ...Endpoint, owner: Type.Literal("serve"), folder: Type.String() }),
]);

export type Registration = Static<typeof Registration>;

export type Owner = NonNullable<Registration["owner"]>;

const OWNERS: readonly Owner[] = ["desktop", "serve", "service"];

const STEP_DOWN_POLL_MS = 5_000;

export function registrationPath(home: string, owner: Owner = "service"): string {
  return join(home, ".nyte", `${owner}.json`);
}

export function registrationOwner(registration: Registration): Owner {
  return registration.owner ?? "service";
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

export async function readRegistrations(home: string): Promise<readonly Registration[]> {
  const registrations = await Promise.all(OWNERS.map((owner) => readOwner(home, owner)));

  return registrations.filter((registration) => registration !== undefined);
}

export async function readRegistration(home: string): Promise<Registration | undefined> {
  return (await readRegistrations(home))[0];
}

async function readOwner(home: string, owner: Owner): Promise<Registration | undefined> {
  const text = await readFile(registrationPath(home, owner), "utf8").catch(() => undefined);

  if (text === undefined) return undefined;

  try {
    const parsed: unknown = JSON.parse(text);

    return Value.Check(Registration, parsed) && registrationOwner(parsed) === owner
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

export async function writeRegistration(home: string, registration: Registration): Promise<void> {
  const path = registrationPath(home, registrationOwner(registration));
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

export async function removeRegistration(home: string, registration: Registration): Promise<void> {
  const owner = registrationOwner(registration);
  const current = await readOwner(home, owner);

  if (current?.pid === registration.pid) await rm(registrationPath(home, owner), { force: true });
}

export function registrationWatcher(home: string, wake: () => void): () => void {
  const files = new Set(OWNERS.map((owner) => `${owner}.json`));

  const watcher = watch(dirname(registrationPath(home)), (_event, file) => {
    if (file === null || files.has(file)) wake();
  });

  return () => watcher.close();
}

export function watchReplacement(
  home: string,
  registration: Registration,
  replaced: () => void,
): () => void {
  let watching = true;

  const check = async (): Promise<void> => {
    const current = await readOwner(home, registrationOwner(registration));
    const store = readStoreOwner(join(home, ".nyte", "nyte.db"));

    const named =
      current?.pid === registration.pid &&
      current.hostId === registration.hostId &&
      current.url === registration.url;

    if (!watching || (named && (store === undefined || store.pid === registration.pid))) return;
    stop();
    replaced();
  };

  const wake = (): void => void check().catch(() => undefined);
  const unwatch = registrationWatcher(home, wake);
  const timer = setInterval(wake, STEP_DOWN_POLL_MS);

  const stop = (): void => {
    watching = false;
    unwatch();
    clearInterval(timer);
  };

  return stop;
}
