import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureService,
  installService,
  readRegistration,
  readSupervision,
  serviceBuild,
  stopService,
  uninstallService,
} from "../src/index.ts";
import { alive, logPath } from "../src/registration.ts";
import {
  findSupervisor,
  relaunchUnit,
  removeUnit,
  renderUnit,
  supervisedPid,
  writeUnit,
} from "../src/supervisor.ts";
import type { Supervisor } from "../src/supervisor.ts";

const FAKE_SERVICE = fileURLToPath(new URL("fixtures/fake-service.ts", import.meta.url));

const FAKE_SUPERVISOR = fileURLToPath(new URL("fixtures/fake-supervisor.ts", import.meta.url));

function fakeService(build: string): readonly [string, ...string[]] {
  return [process.execPath, FAKE_SERVICE, build, "0", "fresh"];
}

const NEVER_STARTED: readonly [string, ...string[]] = [
  process.execPath,
  "-e",
  'console.error("error: The client started the service itself."); process.exit(1);',
];

describe("the installed service", () => {
  const path = process.env["PATH"];
  let root = "";
  let home = "";
  let state = "";
  let supervisor: Supervisor | undefined;
  let v1 = "";
  let v2 = "";

  const calls = async (): Promise<string[]> =>
    (await readFile(join(state, "calls.log"), "utf8").catch(() => "")).split("\n").filter(Boolean);

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nyte-supervisor-")));
    home = join(root, "home");
    state = join(root, "state");
    const bin = join(root, "bin");
    await Promise.all([mkdir(home), mkdir(state), mkdir(bin)]);

    for (const tool of ["launchctl", "systemctl"]) {
      const shim = join(bin, tool);
      await writeFile(
        shim,
        `#!/bin/sh\nexec "${process.execPath}" "${FAKE_SUPERVISOR}" ${tool} "$@"\n`,
      );
      await chmod(shim, 0o755);
    }

    supervisor = findSupervisor(home);
    process.env["PATH"] = `${bin}:${path ?? ""}`;
    process.env["FAKE_SUPERVISOR_STATE"] = state;
    process.env["FAKE_SUPERVISOR_UNIT"] = supervisor?.unit ?? "";
    v1 = await serviceBuild("v1");
    v2 = await serviceBuild("v2");
  });

  afterEach(async () => {
    const pid = Number(await readFile(join(state, "pid"), "utf8").catch(() => "0"));

    if (pid > 0 && alive(pid)) process.kill(pid, "SIGKILL");
    const registered = await readRegistration(home);

    if (registered !== undefined && alive(registered.pid)) process.kill(registered.pid, "SIGKILL");
    await stopService(home);
    process.env["PATH"] = path;
    await rm(root, { recursive: true, force: true });
  });

  it("runs the service under the supervisor, and installing again changes nothing", async () => {
    expect(await readSupervision(home)).toEqual({ kind: "absent", supervisor });

    const installed = await installService({ home, version: "v1", command: fakeService(v1) });

    expect(installed.kind).toBe("installed");
    expect(installed.registration.version).toBe(v1);
    expect(await readSupervision(home)).toEqual({
      kind: "installed",
      supervisor,
      pid: installed.registration.pid,
    });
    expect(await readFile(installed.supervisor.unit, "utf8")).toContain(FAKE_SERVICE);

    const before = await calls();
    const again = await installService({ home, version: "v1", command: fakeService(v1) });

    expect(again).toEqual({ ...installed, kind: "unchanged" });
    expect((await calls()).slice(before.length).join("\n")).not.toMatch(/bootstrap|start/u);
  });

  it("moves a service the client started under the supervisor", async () => {
    const detached = await ensureService({ home, version: "v1", command: fakeService(v1) });

    expect(await readSupervision(home)).toMatchObject({ kind: "absent" });

    const installed = await installService({ home, version: "v1", command: fakeService(v1) });

    expect(installed.kind).toBe("installed");
    expect(installed.registration.pid).not.toBe(detached.pid);
    expect(alive(detached.pid)).toBe(false);
    expect(await readSupervision(home)).toMatchObject({ pid: installed.registration.pid });
  });

  it("replaces a supervised service of another build through the supervisor", async () => {
    const old = await installService({ home, version: "v1", command: fakeService(v1) });

    const replaced = await ensureService({ home, version: "v2", command: fakeService(v2) });

    expect(replaced.version).toBe(v2);
    expect(alive(old.registration.pid)).toBe(false);
    expect(await readSupervision(home)).toMatchObject({ kind: "installed", pid: replaced.pid });
    expect(await readFile(old.supervisor.unit, "utf8")).toContain(v2);
  });

  it("has the supervisor start an installed service that was stopped", async () => {
    await installService({ home, version: "v1", command: fakeService(v1) });
    expect(await stopService(home)).toBe(true);
    const before = await calls();

    const started = await ensureService({ home, version: "v1", command: fakeService(v1) });

    expect(await readSupervision(home)).toMatchObject({ kind: "installed", pid: started.pid });
    expect((await calls()).slice(before.length).join("\n")).toMatch(/kickstart|start/u);
  });

  it("fails with the error the supervised service logged", async () => {
    await installService({ home, version: "v1", command: fakeService(v1) });
    await stopService(home);

    await expect(ensureService({ home, version: "v2", command: NEVER_STARTED })).rejects.toThrow(
      `The client started the service itself. See ${logPath(home)}.`,
    );
  });

  it("stops the supervised service and removes the unit on uninstall", async () => {
    const installed = await installService({ home, version: "v1", command: fakeService(v1) });

    expect(await uninstallService(home)).toBe(true);
    expect(alive(installed.registration.pid)).toBe(false);
    expect(await stat(installed.supervisor.unit).catch(() => undefined)).toBeUndefined();
    expect(await readSupervision(home)).toMatchObject({ kind: "absent" });
    expect(await uninstallService(home)).toBe(false);
  });

  it("runs a systemd user unit through systemctl", async () => {
    const systemd = findSupervisor(home, "linux");

    if (systemd === undefined) throw new Error("Linux always has a supervisor.");
    process.env["FAKE_SUPERVISOR_UNIT"] = systemd.unit;
    const plan = { home, command: fakeService(v1), environment: { HOME: home } };

    expect(await writeUnit(systemd, plan)).toBe(true);
    expect(await writeUnit(systemd, plan)).toBe(false);
    await relaunchUnit(systemd, async () => false);

    let registration = await readRegistration(home);

    while (registration === undefined) registration = await readRegistration(home);
    expect(await supervisedPid(systemd)).toBe(registration.pid);
    expect(await calls()).toEqual([
      "systemctl --user daemon-reload",
      "systemctl --user enable nyte.service",
      "systemctl --user stop nyte.service",
      "systemctl --user start nyte.service",
      "systemctl --user show nyte.service --property=MainPID --value",
    ]);

    expect(await removeUnit(systemd)).toBe(true);
    expect(alive(registration.pid)).toBe(false);
  });
});

describe("renderUnit", () => {
  const plan = {
    home: "/Users/a b",
    command: ["/opt/nyte 1/nyte", "service", "run", "100%", "$HOME"] as const,
    environment: { HOME: "/Users/a b", PATH: "/usr/bin:/bin" },
  };

  it("restarts a systemd unit on failure, escaping spaces, specifiers and variables", () => {
    const systemd = findSupervisor("/Users/a b", "linux");

    if (systemd === undefined) throw new Error("Linux always has a supervisor.");
    const unit = renderUnit(systemd, plan);

    expect(unit).toContain('ExecStart="/opt/nyte 1/nyte" service run 100%% $$HOME\n');
    expect(unit).toContain('Environment="HOME=/Users/a b"\n');
    expect(unit).toContain("Restart=on-failure\n");
    expect(unit).toContain("WantedBy=default.target\n");
    expect(unit).toContain("StandardOutput=append:/Users/a b/.nyte/logs/service.log\n");
  });

  it.runIf(process.platform === "darwin")(
    "starts a launch agent at load and keeps it alive only after a failed exit",
    () => {
      const launchd = findSupervisor("/Users/a b", "darwin");

      if (launchd === undefined) throw new Error("macOS always has a supervisor.");
      const plist = renderUnit(launchd, { ...plan, command: ["/opt/nyte", "a<b&c"] });

      expect(launchd.unit).toBe("/Users/a b/Library/LaunchAgents/sh.nyte.service.plist");
      expect(plist).toContain("<string>a&lt;b&amp;c</string>");
      expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/u);
      expect(plist).toMatch(
        /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/u,
      );
      expect(plist).toContain("<string>/Users/a b/.nyte/logs/service.log</string>");
    },
  );
});
