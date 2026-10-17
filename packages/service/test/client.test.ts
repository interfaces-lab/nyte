import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { ConnectView } from "@nyte-ai/connect";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ensureService,
  readRegistration,
  serviceBuild,
  serviceConnect,
  stopService,
} from "../src/index.ts";
import type { Registration } from "../src/index.ts";
import { alive, lockHolder } from "../src/registration.ts";
import { SERVICE_ROUTES } from "../src/routes.ts";

const FAKE_SERVICE = fileURLToPath(new URL("fixtures/fake-service.ts", import.meta.url));

const UNAVAILABLE: ConnectView = { kind: "unavailable", reason: "not_configured" };

function fakeService(
  build: string,
  delay: number,
  mode: "fresh" | "stale" | "stubborn" = "fresh",
): readonly [string, ...string[]] {
  return [process.execPath, FAKE_SERVICE, build, String(delay), mode];
}

/** Starts a fake service directly and waits until it registers. */
async function runFake(
  home: string,
  command: readonly [string, ...string[]],
): Promise<Registration> {
  const [file, ...args] = command;
  const child = spawn(file, args, { cwd: home, stdio: "ignore" });

  for (;;) {
    const registration = await readRegistration(home);

    if (registration !== undefined && registration.pid === child.pid) return registration;
    await sleep(10);
  }
}

function failingService(message: string): readonly [string, ...string[]] {
  return [process.execPath, "-e", `console.error(${JSON.stringify(message)}); process.exit(1);`];
}

describe("ensureService", () => {
  let home = "";
  let v1 = "";
  let v2 = "";

  beforeEach(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), "nyte-service-")));
    v1 = await serviceBuild("v1", undefined);
    v2 = await serviceBuild("v2", undefined);
  });

  afterEach(async () => {
    const registered = await readRegistration(home);

    if (registered !== undefined && alive(registered.pid)) process.kill(registered.pid, "SIGKILL");
    await stopService(home);
    await rm(home, { recursive: true, force: true });
  });

  it("starts the service and returns the registration it renames into place", async () => {
    const started = await ensureService({ home, version: "v1", command: fakeService(v1, 300) });

    expect(started.version).toBe(v1);
    expect(started.hostId).toBe(`host-${String(started.pid)}`);
    expect(alive(started.pid)).toBe(true);
    expect(await readRegistration(home)).toEqual(started);
  });

  it("returns the running service of the same build without starting another", async () => {
    const started = await ensureService({ home, version: "v1", command: fakeService(v1, 0) });

    const again = await ensureService({
      home,
      version: "v1",
      command: failingService("error: A second service started."),
    });

    expect(again).toEqual(started);
  });

  it("replaces a running service of another version", async () => {
    const old = await ensureService({ home, version: "v1", command: fakeService(v1, 0) });

    const replaced = await ensureService({ home, version: "v2", command: fakeService(v2, 0) });

    expect(replaced.version).toBe(v2);
    expect(replaced.pid).not.toBe(old.pid);
    expect(alive(old.pid)).toBe(false);
  });

  it("replaces a service of the same version built with other operations", async () => {
    const stale = await runFake(home, fakeService("v1+0000000000000000", 0, "stale"));

    const replaced = await ensureService({ home, version: "v1", command: fakeService(v1, 0) });

    expect(replaced.version).toBe(v1);
    expect(replaced.pid).not.toBe(stale.pid);
    expect(alive(stale.pid)).toBe(false);
    const answer = await fetch(new URL("/mcp.watch", replaced.url), { method: "POST" });
    expect(await answer.text()).not.toContain("No operation answers");
  });

  it("replaces a service whose registration carries no operations digest", async () => {
    const stale = await runFake(home, fakeService("v1", 0, "stale"));

    const replaced = await ensureService({ home, version: "v1", command: fakeService(v1, 0) });

    expect(replaced.version).toBe(v1);
    expect(alive(stale.pid)).toBe(false);
  });

  it("replaces a service of the same version and operations built from other code", async () => {
    const before = await serviceBuild("v1", "aaaaaaaaaaaa");
    const after = await serviceBuild("v1", "bbbbbbbbbbbb.0123abcd");

    const old = await ensureService({
      home,
      version: "v1",
      code: "aaaaaaaaaaaa",
      command: fakeService(before, 0),
    });

    const replaced = await ensureService({
      home,
      version: "v1",
      code: "bbbbbbbbbbbb.0123abcd",
      command: fakeService(after, 0),
    });

    expect(before.split("+").slice(0, 2)).toEqual(after.split("+").slice(0, 2));
    expect(replaced.version).toBe(after);
    expect(replaced.pid).not.toBe(old.pid);
    expect(alive(old.pid)).toBe(false);
  });

  it("tells a client its service is gone once a client of another build replaces it", async () => {
    const lost = Promise.withResolvers<void>();
    let gone = false;

    const old = await ensureService({
      home,
      version: "v1",
      command: fakeService(v1, 0),
      lost() {
        gone = true;
        lost.resolve();
      },
    });

    await sleep(100);
    expect(gone).toBe(false);
    await ensureService({ home, version: "v2", command: fakeService(v2, 0) });

    await lost.promise;
    expect(alive(old.pid)).toBe(false);
  });

  it("keeps a service of another build while another client uses it", async () => {
    const old = await ensureService({ home, version: "v1", command: fakeService(v1, 0) });
    const other = new URL(SERVICE_ROUTES.attach, old.url);
    other.searchParams.set("pid", String(process.ppid));
    const held = new AbortController();
    const attached = fetch(other, { signal: held.signal });
    await attached;

    await expect(
      ensureService({ home, version: "v2", command: fakeService(v2, 0) }),
    ).rejects.toThrow(
      `The Nyte service (pid ${String(old.pid)}) runs build ${v1} but this nyte is build ${v2}, and 1 other client still uses it. Quit them, or stop it with \`nyte service stop\`, and try again.`,
    );
    expect(alive(old.pid)).toBe(true);
    held.abort();
  });

  it(
    "names both builds and the fix when the other build won't stop",
    { timeout: 15_000 },
    async () => {
      const stale = await runFake(home, fakeService("v1+0000000000000000", 0, "stubborn"));

      const failed = ensureService({ home, version: "v1", command: fakeService(v1, 0) });

      await expect(failed).rejects.toThrow(
        `The Nyte service (pid ${String(stale.pid)}) runs build v1+0000000000000000 but this nyte is build ${v1}; stop it with \`nyte service stop\` and try again.`,
      );
      await expect(failed).rejects.not.toThrow("No operation answers");
    },
  );

  it("waits for the service that won the start race when its own child exits", async () => {
    const [command, ...args] = fakeService(v1, 500);
    const winner = spawn(command, args, { cwd: home, stdio: "ignore" });

    while ((await lockHolder(home)) === undefined) await sleep(10);

    const found = await ensureService({ home, version: "v1", command: fakeService(v1, 0) });

    expect(found.pid).toBe(winner.pid);
  });

  it("fails as soon as the service exits before it registers, with the error it logged", async () => {
    const begun = Date.now();

    await expect(
      ensureService({ home, version: "v1", command: failingService("error: Port 9 is taken.") }),
    ).rejects.toThrow(`Port 9 is taken. See ${join(home, ".nyte", "logs", "service.log")}.`);
    expect(Date.now() - begun).toBeLessThan(5_000);
  });
});

describe("serviceConnect", () => {
  const token = "t".repeat(32);

  let answer: (request: IncomingMessage, response: ServerResponse) => void = (_request, response) =>
    void response.end();

  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${token}`) {
      response.statusCode = 401;
      response.end(JSON.stringify({ message: "Unauthorized" }));

      return;
    }

    answer(request, response);
  });

  let registration: Registration = { url: "", token, pid: process.pid, version: "v1", hostId: "" };

  beforeEach(async () => {
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = Value.Parse(Type.Object({ port: Type.Number() }), server.address());
    registration = { ...registration, url: `http://127.0.0.1:${String(port)}` };
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise((closed) => server.close(closed));
  });

  it("reads the Connect view with the registration's token", async () => {
    answer = (request, response) => {
      expect(request.url).toBe(SERVICE_ROUTES.connect);
      response.end(JSON.stringify(UNAVAILABLE));
    };

    expect(await serviceConnect(registration).view()).toEqual(UNAVAILABLE);
  });

  it("throws the message the service refuses with", async () => {
    await expect(serviceConnect({ ...registration, token: "u".repeat(32) }).view()).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("parses events whose lines arrive split across chunks", async () => {
    const line = JSON.stringify({ kind: "view", view: UNAVAILABLE });

    answer = (request, response) => {
      expect(request.url).toBe(SERVICE_ROUTES.watch);
      response.write(`${line}\n{"kind":"err`);
      void sleep(20).then(() => response.end('or","message":"boom"}\n'));
    };

    const events = [];

    for await (const event of serviceConnect(registration).watch(new AbortController().signal))
      events.push(event);

    expect(events).toEqual([
      { kind: "view", view: UNAVAILABLE },
      { kind: "error", message: "boom" },
    ]);
  });

  it("ends a held share quietly when its signal aborts", async () => {
    answer = (request, response) => {
      expect(request.url).toBe(SERVICE_ROUTES.share);
      response.write(`${JSON.stringify({ kind: "view", view: UNAVAILABLE })}\n`);
    };

    const controller = new AbortController();
    const events = [];

    for await (const event of serviceConnect(registration).share(controller.signal)) {
      events.push(event);
      controller.abort();
    }

    expect(events).toEqual([{ kind: "view", view: UNAVAILABLE }]);
  });

  it("throws when the service refuses the event stream", async () => {
    const refused = serviceConnect({ ...registration, token: "u".repeat(32) }).watch(
      new AbortController().signal,
    );

    await expect(refused[Symbol.asyncIterator]().next()).rejects.toThrow(
      "The Nyte service answered 401.",
    );
  });
});
