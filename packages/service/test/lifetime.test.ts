import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { generateMachineKey, publicKeySet } from "@nyte-ai/connect/signing";
import { sdk } from "@nyte-ai/sdk";
import type { Host } from "@nyte-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureService,
  IDLE_GRACE_MS,
  serviceBuild,
  serviceClients,
  startService,
} from "../src/index.ts";
import type { Timers } from "../src/index.ts";
import { findSupervisor } from "../src/supervisor.ts";

/** Timers that wait until the test fires them. */
function manualTimers() {
  const pending = new Set<{ readonly callback: () => void; readonly ms: number }>();

  const timers: Timers = {
    wait(callback, ms) {
      const entry = { callback, ms };
      pending.add(entry);

      return () => void pending.delete(entry);
    },
  };

  return {
    pending,
    timers,
    fire() {
      const due = [...pending];
      pending.clear();

      for (const entry of due) entry.callback();
    },
  };
}

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  while (!(await check())) await sleep(10);
}

const NEVER_STARTED: readonly [string, ...string[]] = [
  process.execPath,
  "-e",
  'console.error("error: The test started a second service."); process.exit(1);',
];

describe("the service's lifetime", () => {
  let root = "";
  let home = "";
  let cwd = "";
  let host: Host;
  let clock = manualTimers();
  let idled = false;
  let close: () => Promise<void> = async () => undefined;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nyte-lifetime-")));
    home = join(root, "home");
    cwd = join(root, "workspace");
    await mkdir(join(home, ".nyte"), { recursive: true });
    await mkdir(cwd);
    host = await sdk.open({ home, workspace: { kind: "local", path: cwd } });
    clock = manualTimers();
    idled = false;

    close = await serve(undefined);
  });

  const serve = async (connect: { readonly origin: string } | undefined) => {
    const service = await startService({
      open: async () => host,
      home,
      port: 0,
      version: "v1",
      connect,
      lifetime: { timers: clock.timers, idle: () => void (idled = true) },
    });

    return () => service.close();
  };

  afterEach(async () => {
    await close();
    await rm(root, { recursive: true, force: true });
  });

  it("stays up while a client is attached and stops a grace period after it leaves", async () => {
    const attachment = new AbortController();

    const registration = await ensureService({
      home,
      version: "v1",
      command: NEVER_STARTED,
      signal: attachment.signal,
    });

    await until(async () => (await serviceClients(registration)).length === 1);

    expect(await serviceClients(registration)).toEqual([
      expect.objectContaining({ pid: process.pid, build: await serviceBuild("v1", undefined) }),
    ]);
    expect(clock.pending.size).toBe(0);

    attachment.abort();
    await until(() => clock.pending.size === 1);
    expect([...clock.pending].map((entry) => entry.ms)).toEqual([IDLE_GRACE_MS]);
    expect(idled).toBe(false);

    clock.fire();
    await until(() => idled);
    expect(await serviceClients(registration)).toEqual([]);
  });

  it("stays up while a job runs and stops once it has ended", async () => {
    const added = await host.workspaces.add({ kind: "local", path: cwd });

    if (added.kind !== "added" && added.kind !== "exists") throw new Error(added.kind);
    const job = await host.workspace(added.workspace).jobs.start({ command: "sleep 30" });

    clock.fire();
    await until(() => clock.pending.size === 1);
    expect(idled).toBe(false);

    await job.stop();
    clock.fire();
    await until(() => idled);
  });

  it("refuses to retire for a client of another build while a job runs", async () => {
    const added = await host.workspaces.add({ kind: "local", path: cwd });

    if (added.kind !== "added" && added.kind !== "exists") throw new Error(added.kind);
    const job = await host.workspace(added.workspace).jobs.start({ command: "sleep 30" });

    await expect(ensureService({ home, version: "v2", command: NEVER_STARTED })).rejects.toThrow(
      "and a run or job is still working in it.",
    );
    expect(idled).toBe(false);
    await job.stop();
  });

  it.runIf(findSupervisor("/") !== undefined)("never stops while it's installed", async () => {
    const unit = findSupervisor(home)?.unit ?? "";
    await mkdir(dirname(unit), { recursive: true });
    await writeFile(unit, "");

    clock.fire();
    await until(() => clock.pending.size === 1);
    expect(idled).toBe(false);

    await rm(unit);
    clock.fire();
    await until(() => idled);
  });

  it("never stops while this machine is linked to a Nyte account", async () => {
    await close();
    const origin = "https://connect.nyte.test";
    const signing = { ...(await generateMachineKey()), kid: "broker-1" };

    await writeFile(
      join(home, ".nyte", "connect.json"),
      JSON.stringify({
        version: 4,
        enabled: false,
        link: {
          origin,
          environment: { id: "0b6f4d8e-6c0a-4a43-9d0e-5f0c1f6a7b21", name: "Test Mac" },
          owner: { id: "user_1", label: "test@example.com" },
          key: await generateMachineKey(),
          brokerKeys: publicKeySet([signing]),
          devices: [],
          revocations: [],
          consumed: [],
        },
        linkKey: null,
        unlinks: [],
      }),
      { mode: 0o600 },
    );
    clock = manualTimers();
    host = await sdk.open({ home, workspace: { kind: "local", path: cwd } });
    close = await serve({ origin });

    clock.fire();
    await until(() => clock.pending.size === 1);
    expect(idled).toBe(false);
  });
});
