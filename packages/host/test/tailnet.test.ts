import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Type } from "typebox";
import { memoryStore } from "@nyte-ai/core/store";
import { compile, TailnetStatusType } from "@nyte-ai/schema";
import type { Host } from "@nyte-ai/core";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import manifest from "../package.json" with { type: "json" };
import { openHost } from "../src/index.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";

const TOKEN = "a-token-of-16-chars";

const SIDECAR = `
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const log = (entry) => appendFileSync(join(value("--dir"), "runs.jsonl"), JSON.stringify(entry) + "\\n");

if (args.includes("--logout")) {
  log({ logout: true });
  process.exit(0);
}

log({ pid: process.pid, args, key: args.includes("--auth-key-fd") ? readFileSync(3, "utf8") : null });

const access = value("--access");
const tags = args.flatMap((arg, index) => (args[index - 1] === "--tag" ? [arg] : []));
const say = (status) => process.stdout.write(JSON.stringify({ access, tags, ...status }) + "\\n");

if (BEHAVIOR === "crash")
  process.stderr.write("boom\\n" + "x".repeat(5000) + "\\nlast words\\n", () => process.exit(3));

if (BEHAVIOR !== "silent")
  process.stdout.write(
    JSON.stringify({
      type: "hello",
      protocol: BEHAVIOR === "protocol" ? 2 : 1,
      version: BEHAVIOR === "outdated" ? "0.0.1" : VERSION,
    }) + "\\n",
  );

if (BEHAVIOR === "garbage") say({ state: "sideways" });

if (BEHAVIOR === "stuck" || BEHAVIOR === "ready") say({ state: "starting", https: "pending" });

if (BEHAVIOR === "ready")
  say({ state: "running", dnsName: value("--hostname") + ".example.ts.net", https: "available" });
process.on("SIGTERM", () => {
  say({ state: "stopped", https: "pending" });
  process.exit(0);
});
process.stdin.on("end", () => process.exit(0)).resume();
`;

type Run = {
  readonly pid?: number;
  readonly args?: readonly string[];
  readonly key?: string | null;
  readonly logout?: true;
};

type Answer = { readonly status: number; readonly body: unknown };

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.useRealTimers();

  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

type Behavior = "ready" | "silent" | "stuck" | "protocol" | "outdated" | "garbage" | "crash";

async function setup(
  behavior: Behavior = "ready",
): Promise<{ readonly home: string; readonly binary: string }> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-tailnet-")));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  const binary = join(home, "nyte-tailnet");
  const constants = `const BEHAVIOR = ${JSON.stringify(behavior)};\nconst VERSION = ${JSON.stringify(manifest.version)};\n`;
  await writeFile(binary, `#!${process.execPath}\n${constants}${SIDECAR}`);
  await chmod(binary, 0o755);

  return { home, binary };
}

async function open(home: string, binary: string): Promise<Host> {
  const host = await openHost({
    store: memoryStore(),
    models: fakeModels().models,
    plugins: [chatOnly],
    workspace: { kind: "chat-only", locator: null },
    home,
    tailnet: { binary },
  });

  cleanups.push(() => host.close());

  return host;
}

async function localSocket(host: Host, home: string): Promise<string> {
  const path = join(home, "host.sock");
  await host.listen({ transport: { kind: "socket", path }, auth: { kind: "token", token: TOKEN } });

  return path;
}

function post(
  socketPath: string,
  name: string,
  body: unknown,
  headers: Readonly<Record<string, string>> = { Authorization: `Bearer ${TOKEN}` },
): Promise<Answer> {
  return new Promise<Answer>((answered, failed) => {
    const sent = request(
      {
        socketPath,
        path: `/${name}`,
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", Host: "nyte.example.ts.net" },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          const text = Buffer.concat(chunks).toString("utf8");
          const frame = /^data: (.*)$/m.exec(text)?.[1];

          if (frame === undefined) return;
          answered({ status: response.statusCode ?? 0, body: JSON.parse(frame) });
          response.destroy();
        });
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          answered({
            status: response.statusCode ?? 0,
            body: text === "" ? null : JSON.parse(text),
          });
        });
      },
    );

    sent.on("error", failed);
    sent.end(JSON.stringify(body));
  });
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  for (;;) {
    const value = await read();

    if (done(value)) return value;
    await sleep(20);
  }
}

async function runs(home: string): Promise<readonly Run[]> {
  const text = await readFile(join(home, ".nyte", "tailnet", "runs.jsonl"), "utf8").catch(() => "");

  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line): Run => JSON.parse(line));
}

function principalHeader(userId: string, owner: boolean) {
  const principal = {
    kind: "tailscale",
    userId,
    loginName: "ada@example.com",
    node: "n1",
    tags: [],
    owner,
  };

  return {
    "X-Nyte-Tailnet-Principal": Buffer.from(JSON.stringify(principal)).toString("base64url"),
  };
}

const status = (socket: string) => post(socket, "host.tailnet.status", {});

const enable = (socket: string) =>
  post(socket, "host.tailnet.configure", {
    enabled: true,
    hostname: "nyte",
    tags: [],
    access: "owner",
  });

function warnings(): readonly string[] {
  const seen: string[] = [];

  const listener = (warning: Error) => {
    seen.push(warning.message);
  };

  process.on("warning", listener);
  cleanups.push(async () => {
    process.off("warning", listener);
  });

  return seen;
}

const sidecarLog = (home: string) =>
  readFile(join(home, ".nyte", "tailnet", "sidecar.log"), "utf8").catch(() => "");

const statusCheck = compile(TailnetStatusType);

function readStderr(answer: Answer): string {
  return statusCheck.Check(answer.body) ? (answer.body.stderr ?? "") : "";
}

const stateIs = (state: string) => (answer: Answer) =>
  typeof answer.body === "object" &&
  answer.body !== null &&
  "state" in answer.body &&
  answer.body.state === state;

describe.skipIf(process.platform === "win32")("the embedded tailnet node", () => {
  it("saves its settings without the auth key, hands the key over fd 3 once, and starts again from the saved settings", async () => {
    const { home, binary } = await setup();
    const first = await open(home, binary);
    const socket = await localSocket(first, home);

    expect((await status(socket)).body).toEqual({
      state: "disabled",
      https: "unavailable",
      access: "owner",
      tags: [],
    });

    const configured = await post(socket, "host.tailnet.configure", {
      enabled: true,
      hostname: "studio",
      tags: ["tag:ci"],
      access: "tailnet",
      authKey: "tskey-secret",
    });

    expect(configured.status).toBe(200);
    expect((await until(() => status(socket), stateIs("running"))).body).toEqual({
      state: "running",
      dnsName: "studio.example.ts.net",
      https: "available",
      access: "tailnet",
      tags: ["tag:ci"],
    });

    const saved = await readFile(join(home, ".nyte", "tailnet.json"), "utf8");

    expect(JSON.parse(saved)).toEqual({
      enabled: true,
      hostname: "studio",
      tags: ["tag:ci"],
      access: "tailnet",
    });
    expect(saved).not.toContain("tskey");
    expect((await runs(home))[0]).toMatchObject({ key: "tskey-secret" });
    expect((await runs(home))[0]?.args).toEqual(expect.arrayContaining(["--auth-key-fd", "3"]));
    expect((await runs(home))[0]?.args?.join(" ")).not.toContain("tskey");

    await first.close();
    const second = await open(home, binary);

    for await (const view of second.watch()) if (view.tailnet?.state === "running") break;

    expect((await runs(home))[1]).toMatchObject({ key: null });

    const again = await localSocket(second, home);
    const signedOut = await post(again, "host.tailnet.logout", {});

    expect(signedOut.body).toEqual({
      state: "disabled",
      https: "unavailable",
      access: "tailnet",
      tags: ["tag:ci"],
    });
    expect((await runs(home)).at(-1)).toEqual({ logout: true });
    expect(JSON.parse(await readFile(join(home, ".nyte", "tailnet.json"), "utf8"))).toMatchObject({
      enabled: false,
    });
  });

  it("answers local operations only on the local socket and admits the sidecar's callers as their tailscale principal", async () => {
    const { home, binary } = await setup();
    const host = await open(home, binary);
    const socket = await localSocket(host, home);

    const network = await host.listen({
      transport: { kind: "http" },
      auth: { kind: "token", token: TOKEN },
    });

    const overNetwork = await fetch(`${network.address}/host.tailnet.status`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: "{}",
    });

    expect(overNetwork.status).toBe(403);
    expect(await overNetwork.json()).toMatchObject({ code: "denied" });

    await post(socket, "host.tailnet.configure", {
      enabled: true,
      hostname: "nyte",
      tags: [],
      access: "owner",
    });
    await until(() => status(socket), stateIs("running"));

    const tailnet = join(home, ".nyte", "tailnet.sock");

    const owner = principalHeader("7", true);

    const overTailnet = await post(tailnet, "host.tailnet.status", {}, owner);

    expect(overTailnet.status).toBe(403);

    const view = await post(
      tailnet,
      "connection.watch",
      {},
      {
        ...owner,
        Authorization: `Bearer ${TOKEN}`,
      },
    );

    expect(view.body).toMatchObject({
      principal: "tailscale:user:7",
      authority: ["participant", "owner"],
      tailnet: { state: "running", access: "owner" },
    });

    const member = await post(tailnet, "connection.watch", {}, principalHeader("8", false));

    expect(member.body).toMatchObject({
      principal: "tailscale:user:8",
      authority: ["participant"],
    });
    expect((await post(tailnet, "models.list", {}, {})).status).toBe(401);
  });

  it("reads stopped while it restarts a node that exited on its own", async () => {
    const { home, binary } = await setup();
    const host = await open(home, binary);
    const socket = await localSocket(host, home);

    await post(socket, "host.tailnet.configure", {
      enabled: true,
      hostname: "nyte",
      tags: [],
      access: "owner",
    });
    await until(() => status(socket), stateIs("running"));
    const crashed = (await runs(home))[0]?.pid;

    expect(crashed).toBeTypeOf("number");
    process.kill(crashed ?? 0, "SIGKILL");

    expect((await until(() => status(socket), stateIs("stopped"))).body).toMatchObject({
      state: "stopped",
      https: "unavailable",
    });
    await until(() => status(socket), stateIs("running"));

    const restarted = await runs(home);

    expect(restarted).toHaveLength(2);
    expect(restarted[1]?.pid).not.toBe(crashed);
  });

  it("stops a node that never says hello or never gets ready, and starts it again", async () => {
    const silent = await setup("silent");
    const quiet = await open(silent.home, silent.binary);
    const quietSocket = await localSocket(quiet, silent.home);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await enable(quietSocket);
    await until(
      () => runs(silent.home),
      (found) => found.length === 1,
    );
    vi.advanceTimersByTime(10_000);

    expect((await until(() => status(quietSocket), stateIs("stopped"))).body).toMatchObject({
      reason: "hello_timeout",
    });
    vi.advanceTimersByTime(1_000);
    await until(
      () => runs(silent.home),
      (found) => found.length === 2,
    );

    const stuck = await setup("stuck");
    const waiting = await open(stuck.home, stuck.binary);
    const waitingSocket = await localSocket(waiting, stuck.home);
    await enable(waitingSocket);
    await until(
      () => runs(stuck.home),
      (found) => found.length === 1,
    );
    vi.advanceTimersByTime(119_000);

    expect((await status(waitingSocket)).body).toMatchObject({ state: "starting" });
    vi.advanceTimersByTime(1_000);

    expect((await until(() => status(waitingSocket), stateIs("stopped"))).body).toMatchObject({
      reason: "start_timeout",
    });
    vi.advanceTimersByTime(1_000);
    await until(
      () => runs(stuck.home),
      (found) => found.length === 2,
    );
  });

  it("refuses a node that speaks another protocol and doesn't start it again", async () => {
    const { home, binary } = await setup("protocol");
    const host = await open(home, binary);
    const socket = await localSocket(host, home);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await enable(socket);

    expect((await until(() => status(socket), stateIs("stopped"))).body).toMatchObject({
      reason: "protocol",
      detail: `nyte-tailnet ${manifest.version} speaks protocol 2, but this host speaks 1.`,
    });
    vi.advanceTimersByTime(60_000);
    await sleep(100);

    expect(await runs(home)).toHaveLength(1);
  });

  it("refuses a node built for another version and says which", async () => {
    const { home, binary } = await setup("outdated");
    const host = await open(home, binary);
    const socket = await localSocket(host, home);
    await enable(socket);

    expect((await until(() => status(socket), stateIs("stopped"))).body).toMatchObject({
      reason: "version",
      detail: `${binary} is version 0.0.1, but this host is ${manifest.version}. Reinstall Nyte so they match.`,
    });
  });

  it("logs a status it can't read and restarts the node instead of dropping the line", async () => {
    const { home, binary } = await setup("garbage");
    const host = await open(home, binary);
    const socket = await localSocket(host, home);
    await enable(socket);

    expect((await until(() => status(socket), stateIs("stopped"))).body).toMatchObject({
      reason: "invalid_status",
    });
    await until(
      () => sidecarLog(home),
      (log) => log.includes('"sideways"'),
    );
    await until(
      () => runs(home),
      (found) => found.length === 2,
    );
  });

  it("logs the node's stderr to sidecar.log, not process warnings, and attaches its last 4 KiB to the stopped status", async () => {
    const { home, binary } = await setup("crash");
    const host = await open(home, binary);
    const socket = await localSocket(host, home);
    const logged = warnings();
    await enable(socket);

    const stopped = await until(() => status(socket), stateIs("stopped"));

    expect(stopped.body).toMatchObject({
      reason: "exited",
      detail: "nyte-tailnet exited with code 3.",
    });

    const log = await until(
      () => sidecarLog(home),
      (text) => text.includes("last words"),
    );

    expect(log).toContain("boom\n");
    expect(
      logged.filter((message) => message.includes("boom") || message.includes("last words")),
    ).toEqual([]);

    const tail = readStderr(stopped);

    expect(Buffer.byteLength(tail)).toBe(4096);
    expect(tail.endsWith("x\nlast words\n")).toBe(true);
  });
});

const PARENT = `
import { memoryStore } from "@nyte-ai/core/store";
import { openHost } from "./src/index.ts";
import { chatOnly, fakeModels } from "./test/fixtures/fake-models.ts";

const host = await openHost({
  store: memoryStore(),
  models: fakeModels().models,
  plugins: [chatOnly],
  workspace: { kind: "chat-only", locator: null },
  home: process.argv[1],
  tailnet: { binary: process.argv[2] },
});

for await (const view of host.watch()) if (view.tailnet?.state === "needs_login") break;
process.stdout.write("needs_login\\n");
setInterval(() => undefined, 1000);
`;

const lockCheck = compile(Type.Object({ pid: Type.Number(), instance: Type.String() }));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

async function lockHolder(home: string): Promise<number | null> {
  const text = await readFile(join(home, ".nyte", "tailnet", "nyte-tailnet.lock"), "utf8").catch(
    () => "{}",
  );

  const held: unknown = JSON.parse(text);

  return lockCheck.Check(held) && alive(held.pid) ? held.pid : null;
}

describe.skipIf(process.platform === "win32")("the nyte-tailnet binary", () => {
  let folder = "";
  let binary = "";

  afterAll(() => rm(folder, { recursive: true, force: true }));

  beforeAll(async () => {
    folder = await realpath(await mkdtemp(join(tmpdir(), "nyte-tailnet-bin-")));
    binary = join(folder, "nyte-tailnet");
    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL("../../tailnet/build.mjs", import.meta.url)),
      binary,
    ]);
  }, 300_000);

  it("stops within a second once the host holding it is killed", async () => {
    const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-tailnet-")));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    await mkdir(join(home, ".nyte"), { recursive: true });
    await writeFile(
      join(home, ".nyte", "tailnet.json"),
      JSON.stringify({ enabled: true, hostname: "nyte", tags: [], access: "owner" }),
    );

    const parent = spawn(
      process.execPath,
      ["--input-type=module", "--eval", PARENT, home, binary],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        env: {
          ...process.env,
          TS_CONTROL_URL: "http://127.0.0.1:9",
          TS_NO_LOGS_NO_SUPPORT: "true",
        },
        stdio: ["ignore", "pipe", "ignore"],
      },
    );

    cleanups.push(async () => {
      parent.kill("SIGKILL");
    });

    await new Promise<void>((ready, failed) => {
      createInterface({ input: parent.stdout }).once("line", () => ready());
      parent.once("exit", (code) => failed(new Error(`The host exited with ${String(code)}.`)));
    });
    const sidecar = await lockHolder(home);

    expect(sidecar).not.toBe(parent.pid);
    parent.kill("SIGKILL");
    const killed = performance.now();
    await until(
      async () => sidecar !== null && alive(sidecar),
      (running) => !running,
    );

    expect(performance.now() - killed).toBeLessThan(1_500);
  });
});
