import { access, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { ConnectRuntime, hostShare } from "@nyte-ai/connect/host";
import { sdk } from "@nyte-ai/sdk";
import type { Host, Listener } from "@nyte-ai/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  desktopService,
  ensureService,
  findService,
  readRegistration,
  retireService,
  serviceClients,
  serviceConnect,
  stopService,
} from "../src/index.ts";
import type { DesktopService } from "../src/index.ts";
import { registrationPath, writeRegistration } from "../src/registration.ts";
import { SERVICE_ROUTES } from "../src/routes.ts";

const NEVER_STARTED: readonly [string, ...string[]] = [
  process.execPath,
  "-e",
  'console.error("error: The test started a service while Nyte.app owns the store."); process.exit(1);',
];

const TOKEN = "d".repeat(32);

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  while (!(await check())) await sleep(10);
}

describe("Nyte.app's registration", () => {
  let root = "";
  let home = "";
  let host: Host;
  let listener: Listener;
  let connect: ConnectRuntime;
  let service: DesktopService;

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "nyte-desktop-service-")));
    home = join(root, "home");
    await mkdir(join(root, "workspace"), { recursive: true });
    host = await sdk.open({ home, workspace: { kind: "local", path: join(root, "workspace") } });

    connect = new ConnectRuntime({
      config: undefined,
      home: join(home, ".nyte"),
      authorizer: undefined,
      onChange: () => service.connectChanged(),
    });

    service = desktopService({
      home,
      token: TOKEN,
      version: "0.0.1",
      connect,
      share: hostShare(host),
    });

    listener = await host.listen({
      transport: { kind: "http", port: 0 },
      auth: { kind: "token", token: TOKEN },
      before: service.before,
    });
    await service.register({ url: listener.address ?? "", hostId: host.hostId });
  });

  afterEach(async () => {
    await service.close();
    await connect.close();
    await host.close();
    await rm(root, { recursive: true, force: true });
  });

  it("registers apart from the service, where only a nyte that knows the app reads it", async () => {
    expect(await readRegistration(home)).toMatchObject({ owner: "desktop", pid: process.pid });
    await expect(access(registrationPath(home))).rejects.toThrow();
  });

  it("is what a nyte of another build connects to, and it never retires", async () => {
    const attachment = new AbortController();

    const registration = await ensureService({
      home,
      version: "v2",
      command: NEVER_STARTED,
      signal: attachment.signal,
    });

    expect(registration).toMatchObject({ owner: "desktop", pid: process.pid, hostId: host.hostId });
    await until(async () => (await serviceClients(registration)).length === 1);

    const retire = new URL(SERVICE_ROUTES.retire, registration.url);
    retire.searchParams.set("pid", String(process.pid));

    const refused = await fetch(retire, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });

    expect(refused.status).toBe(404);
    expect(await retireService(home)).toEqual({ kind: "desktop", registration });
    expect(await stopService(home)).toEqual([
      { kind: "desktop", registration, clients: await serviceClients(registration) },
    ]);
    expect(await findService(home)).toEqual(registration);
    attachment.abort();
  });

  it("serves Nyte Connect to a nyte through the app's own runtime", async () => {
    const registration = await ensureService({ home, version: "v2", command: NEVER_STARTED });

    expect(await serviceConnect(registration).view()).toEqual({
      kind: "unavailable",
      reason: "not_configured",
    });
  });

  it("refuses a nyte that speaks another protocol, and leaves the app running", async () => {
    const registered = await readRegistration(home);

    if (registered?.owner !== "desktop") throw new Error("Nyte.app didn't register.");
    await writeRegistration(home, { ...registered, operations: "0000000000000000" });

    await expect(ensureService({ home, version: "v2", command: NEVER_STARTED })).rejects.toThrow(
      "Update nyte or Nyte.app so both are the same release, or quit Nyte.app",
    );
    expect(await findService(home)).toMatchObject({ owner: "desktop", pid: process.pid });
  });

  it("ends its clients' attachments and its registration when the app quits", async () => {
    const lost = Promise.withResolvers<"desktop" | null>();
    const attachment = new AbortController();
    const registration = await ensureService({
      home,
      version: "v2",
      command: NEVER_STARTED,
      signal: attachment.signal,
      lost: lost.resolve,
    });
    await until(async () => (await serviceClients(registration)).length === 1);

    await service.close();
    await listener.close();

    expect(await lost.promise).toBeNull();
    expect(await readRegistration(home)).toBeUndefined();
    attachment.abort();
  });
});
