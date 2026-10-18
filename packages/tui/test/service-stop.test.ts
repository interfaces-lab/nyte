import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { asId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk/client";
import type { Connection } from "@nyte-ai/sdk";
import { findService, stopService } from "@nyte-ai/service";
import type { Registration } from "@nyte-ai/service";
import { expect, test } from "bun:test";

const BINARY = join(import.meta.dir, "..", "src", "binary.ts");

const TOKEN = "s".repeat(32);

async function isolate() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-stop-")));
  const home = join(root, "home");
  const cwd = join(root, "workspace");
  await mkdir(join(home, ".nyte"), { recursive: true, mode: 0o700 });
  await mkdir(cwd, { recursive: true });

  return {
    root,
    home,
    cwd,
    env: { HOME: home, NYTE_HOME: join(home, ".nyte"), PATH: process.env["PATH"] ?? "" },
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function processTable(): Promise<ReadonlyMap<number, number>> {
  const listed = await new Promise<string>((done) => {
    execFile("ps", ["-axo", "pid=,ppid="], (_error, stdout) => done(stdout));
  });

  return new Map(
    listed.split("\n").flatMap((line) => {
      const [pid = "", ppid = ""] = line.trim().split(/\s+/u);

      return pid === "" ? [] : [[Number(pid), Number(ppid)] as const];
    }),
  );
}

async function descendants(pid: number): Promise<readonly number[]> {
  const table = await processTable();
  const found: number[] = [];
  const queue = [pid];

  for (let parent = queue.shift(); parent !== undefined; parent = queue.shift())
    for (const [child, ppid] of table)
      if (ppid === parent && !found.includes(child)) {
        found.push(child);
        queue.push(child);
      }

  return found;
}

async function registered(home: string, owner: Registration["owner"]): Promise<Registration> {
  const deadline = Date.now() + 60_000;

  while (Date.now() < deadline) {
    const found = await findService(home);

    if (found !== undefined && (found.owner ?? "service") === (owner ?? "service")) return found;
    await Bun.sleep(50);
  }

  throw new Error(`No ${String(owner)} registered in ${home}.`);
}

async function runJob(connection: Connection, cwd: string): Promise<void> {
  const added = await connection.workspaces.add({ kind: "local", path: cwd });

  if (added.kind !== "added" && added.kind !== "exists") throw new Error(added.kind);
  await connection.workspace(added.workspace).jobs.start({ command: "sleep 300" });
}

async function settled(pids: readonly number[]): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline && pids.some(alive)) await Bun.sleep(50);
}

test("`nyte service stop` ends the service, exits it 0, and takes the job it ran with it", async () => {
  const { root, home, cwd, env } = await isolate();

  const child = Bun.spawn([process.execPath, BINARY, "service", "run"], {
    cwd: home,
    env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    const service = await registered(home, undefined);
    expect(service.pid).toBe(child.pid);

    const connection = await sdk.connect({
      url: service.url,
      credentials: { kind: "token", token: service.token },
      expect: { hostId: asId(service.hostId) },
    });

    await runJob(connection, cwd);
    await connection.close();
    const children = await descendants(child.pid);
    expect(children.length).toBeGreaterThan(0);

    expect(await stopService(home)).toEqual([
      { kind: "stopped", owner: "service", pid: child.pid, how: "exited", orphans: 0 },
    ]);
    expect(await child.exited).toBe(0);
    await settled(children);

    for (const pid of children) expect(alive(pid)).toBe(false);
    expect(await findService(home)).toBeUndefined();
  } finally {
    child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("`nyte service stop` ends a `nyte serve` it finds registered, with the job it ran", async () => {
  const { root, home, cwd, env } = await isolate();

  const child = Bun.spawn([process.execPath, BINARY, "serve", "--token", TOKEN], {
    cwd,
    env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

  try {
    const serve = await registered(home, "serve");
    expect(serve).toMatchObject({ owner: "serve", pid: child.pid, folder: cwd, token: TOKEN });

    const connection = await sdk.connect({
      url: serve.url,
      credentials: { kind: "token", token: TOKEN },
      expect: { hostId: asId(serve.hostId) },
    });

    await runJob(connection, cwd);
    await connection.close();
    const children = await descendants(child.pid);
    expect(children.length).toBeGreaterThan(0);

    expect(await stopService(home)).toEqual([
      { kind: "stopped", owner: "serve", pid: child.pid, how: "exited", orphans: 0 },
    ]);
    expect(await child.exited).toBe(0);
    await settled(children);

    for (const pid of children) expect(alive(pid)).toBe(false);
    expect(await findService(home)).toBeUndefined();
  } finally {
    child.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
