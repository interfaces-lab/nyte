import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { ConnectRuntime, hostShare } from "@nyte-ai/connect/host";
import { openHost } from "@nyte-ai/host";
import { asId } from "@nyte-ai/schema";
import { sdk } from "@nyte-ai/sdk/client";
import {
  commandLink,
  desktopService,
  findService,
  readRegistration,
  stopService,
  writeRegistration,
} from "@nyte-ai/service";
import type { Registration } from "@nyte-ai/service";
import { expect, test } from "bun:test";
import { VERSION } from "../src/version.ts";
import { isolate } from "./service.ts";

const BINARY =
  process.env["NYTE_BINARY"] ?? fileURLToPath(new URL("../../../bin/nyte", import.meta.url));

const FAKE_SUPERVISOR = fileURLToPath(
  new URL("../../service/test/fixtures/fake-supervisor.ts", import.meta.url),
);

const TOKEN = "q".repeat(32);

type Child = ReturnType<typeof Bun.spawn>;

function spawn(args: readonly string[], env: Readonly<Record<string, string>>, cwd: string) {
  return Bun.spawn([BINARY, ...args], {
    cwd,
    env: { ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

async function registered(
  home: string,
  accept: (registration: Registration) => boolean,
): Promise<Registration> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    const found = await findService(home);

    if (found !== undefined && accept(found)) return found;
    await Bun.sleep(50);
  }

  throw new Error(`Nothing the test waited for registered in ${home}.`);
}

async function exitsWithin(child: Child, ms: number): Promise<number | "running"> {
  return Promise.race([child.exited, Bun.sleep(ms).then(() => "running" as const)]);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function descendants(pid: number): Promise<readonly number[]> {
  const listed = await new Promise<string>((done) => {
    execFile("ps", ["-axo", "pid=,ppid="], (_error, stdout) => done(stdout));
  });

  const table = listed.split("\n").flatMap((line) => {
    const [child = "", parent = ""] = line.trim().split(/\s+/u);

    return child === "" ? [] : [[Number(child), Number(parent)] as const];
  });

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

async function runJob(registration: Registration, cwd: string): Promise<readonly number[]> {
  const connection = await sdk.connect({
    url: registration.url,
    credentials: { kind: "token", token: registration.token },
    expect: { hostId: asId(registration.hostId) },
  });

  try {
    const added = await connection.workspaces.add({ kind: "local", path: cwd });

    if (added.kind !== "added" && added.kind !== "exists") throw new Error(added.kind);
    await connection.workspace(added.workspace).jobs.start({ command: "sleep 300" });
  } finally {
    await connection.close();
  }

  const jobs = await descendants(registration.pid);
  expect(jobs.length).toBeGreaterThan(0);

  return jobs;
}

async function settled(pids: readonly number[]): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline && pids.some(alive)) await Bun.sleep(50);
}

test("of two services started against one home, one serves it and the other exits 0", async () => {
  const { root, home, cwd, env } = await isolate();
  const first = spawn(["service", "run"], env, cwd);
  const second = spawn(["service", "run"], env, cwd);

  try {
    const service = await registered(home, () => true);
    const [winner, loser] = service.pid === first.pid ? [first, second] : [second, first];

    expect(service.pid).toBe(winner.pid);
    expect(await exitsWithin(loser, 20_000)).toBe(0);
    expect(await new Response(loser.stderr).text()).toMatch(/^error: /u);
    expect(winner.exitCode).toBeNull();
    expect((await findService(home))?.pid).toBe(winner.pid);

    await stopService(home);
    expect(await exitsWithin(winner, 10_000)).toBe(0);
  } finally {
    first.kill("SIGKILL");
    second.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("a service and a `nyte serve` step down with exit 0 and stop their jobs once their registration names another process", async () => {
  const { root, home, cwd, env } = await isolate();
  const service = spawn(["service", "run"], env, cwd);
  let serve: Child | undefined;

  try {
    const running = await registered(home, (found) => found.pid === service.pid);
    const serviceJobs = await runJob(running, cwd);

    await writeRegistration(home, { ...running, pid: process.pid, hostId: "replacement" });
    expect(await exitsWithin(service, 20_000)).toBe(0);
    await settled(serviceJobs);

    for (const pid of serviceJobs) expect(alive(pid)).toBe(false);
    await rm(join(home, ".nyte", "service.json"), { force: true });

    const started = spawn(["serve", "--token", TOKEN], env, cwd);
    serve = started;
    const serving = await registered(home, (found) => found.pid === started.pid);
    const serveJobs = await runJob(serving, cwd);

    await writeRegistration(home, { ...serving, pid: process.pid, hostId: "replacement" });
    expect(await exitsWithin(started, 20_000)).toBe(0);
    await settled(serveJobs);

    for (const pid of serveJobs) expect(alive(pid)).toBe(false);
  } finally {
    service.kill("SIGKILL");
    serve?.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("a nyte retires a service whose registration names an older build, which exits 0, and starts its own", async () => {
  const { root, home, cwd, env } = await isolate();
  const older = spawn(["service", "run"], env, cwd);

  try {
    const running = await registered(home, (found) => found.pid === older.pid);
    await writeRegistration(home, { ...running, version: "0.0.1+older" });

    const status = spawn(["status", "--json"], env, cwd);
    expect(await exitsWithin(status, 60_000)).toBe(0);
    expect(await exitsWithin(older, 10_000)).toBe(0);

    const replacement = await readRegistration(home);
    expect(replacement?.pid).not.toBe(older.pid);
    expect(replacement?.version).toBe(running.version);
  } finally {
    older.kill("SIGKILL");
    await stopService(home);
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("with Nyte.app registered, nyte uses the app's host and never stops it", async () => {
  const { root, home, cwd, env } = await isolate();
  const host = await openHost({ home, workspace: { kind: "local", path: cwd } });

  const connect = new ConnectRuntime({
    config: undefined,
    home: join(home, ".nyte"),
    authorizer: undefined,
    onChange: () => app.connectChanged(),
  });

  const app = desktopService({
    home,
    token: TOKEN,
    version: VERSION,
    connect,
    share: hostShare(host),
  });

  try {
    const listener = await host.listen({
      transport: { kind: "http", port: 0 },
      auth: { kind: "token", token: TOKEN },
      before: app.before,
    });

    await app.register({ url: listener.address ?? "", hostId: host.hostId });

    const status = spawn(["status", "--json"], env, cwd);
    expect(await exitsWithin(status, 60_000)).toBe(0);
    const [first = ""] = (await new Response(status.stdout).text()).split("\n");
    expect(JSON.parse(first)).toMatchObject({ type: "status" });

    const stop = spawn(["service", "stop"], env, cwd);
    expect(await exitsWithin(stop, 30_000)).toBe(0);
    expect(await new Response(stop.stdout).text()).toContain(
      `Nyte.app (pid ${String(process.pid)}) has your chats open; quit it to close them.`,
    );

    expect(await findService(home)).toMatchObject({ owner: "desktop", pid: process.pid });
    expect(
      await readFile(join(home, ".nyte", "service.json"), "utf8").catch(() => null),
    ).toBeNull();
  } finally {
    await app.close();
    await connect.close();
    await host.close();
    await stopService(home);
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

test("`nyte service install` through the command link writes a unit that runs the link", async () => {
  const { root, home, cwd, env } = await isolate();
  const shims = join(root, "shims");
  const state = join(root, "supervisor");
  const link = commandLink(home);
  await Promise.all([mkdir(shims), mkdir(state), mkdir(join(home, ".nyte", "bin"))]);
  await symlink(BINARY, link);

  for (const tool of ["launchctl", "systemctl"]) {
    await writeFile(
      join(shims, tool),
      `#!/bin/sh\nexec "${process.execPath}" "${FAKE_SUPERVISOR}" ${tool} "$@"\n`,
    );
    await chmod(join(shims, tool), 0o755);
  }

  const unit =
    process.platform === "linux"
      ? join(home, ".config", "systemd", "user", "nyte.service")
      : join(home, "Library", "LaunchAgents", "sh.nyte.service.plist");

  const supervised = {
    ...env,
    PATH: `${shims}:${env.PATH}`,
    FAKE_SUPERVISOR_STATE: state,
    FAKE_SUPERVISOR_UNIT: unit,
  };

  const resolved = Bun.spawnSync(["sh", "-c", "command -v launchctl systemctl"], {
    env: supervised,
  });

  expect(resolved.stdout.toString().trim().split("\n")).toEqual([
    join(shims, "launchctl"),
    join(shims, "systemctl"),
  ]);

  try {
    const install = Bun.spawn([link, "service", "install"], {
      cwd,
      env: supervised,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(await exitsWithin(install, 60_000)).toBe(0);
    expect(await readFile(unit, "utf8")).toContain(link);
    expect(await readFile(unit, "utf8")).not.toContain(BINARY);

    const uninstall = Bun.spawn([link, "service", "uninstall"], {
      cwd,
      env: supervised,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });

    expect(await exitsWithin(uninstall, 30_000)).toBe(0);
    expect(await findService(home)).toBeUndefined();
  } finally {
    await stopService(home);
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);
