/**
 * The connector against stand-in `cloudflared` scripts. Each stand-in records
 * how it was started, then plays a scripted series of JSON log records, each
 * step waiting for the test to create a named file, so no assertion races a
 * timer. Nothing here reaches Cloudflare.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test, vi } from "vitest";
import {
  CloudflaredConnector,
  prepareConnectorDirectory,
  routesOnlyTo,
  SUPERVISOR_SCRIPT,
} from "./cloudflared.ts";
import type { ConnectorTiming } from "./cloudflared.ts";

const HOSTNAME = "nyte.example.test";

const PORT = 47_123;

const TOKEN = "fixture-tunnel-token";

const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

type Step =
  | { readonly kind: "emit"; readonly line: string }
  | { readonly kind: "await"; readonly file: string }
  | { readonly kind: "exit"; readonly code: number };

interface LogRecord {
  readonly message: string;
  readonly connIndex?: number;
  readonly version?: number;
  readonly config?: string;
}

interface IngressRule {
  readonly hostname?: string;
  readonly path?: string;
  readonly service: string;
  readonly originRequest?: { readonly bastionMode?: boolean };
}

function line(record: LogRecord): Step {
  return { kind: "emit", line: JSON.stringify({ level: "info", ...record }) };
}

function routes(ingress: readonly IngressRule[]): Step {
  return line({
    message: "Updated to new configuration",
    version: 1,
    config: JSON.stringify({ ingress, "warp-routing": {} }),
  });
}

const ROUTED = routes([
  { hostname: HOSTNAME, service: `http://127.0.0.1:${String(PORT)}` },
  { service: "http_status:404" },
]);

const REGISTERED = line({ message: "Registered tunnel connection", connIndex: 0 });

/** A stand-in that logs its start to `starts`, plays `steps`, then idles until signalled. */
async function standIn(
  options: { readonly steps: readonly Step[]; readonly ignoreTerm?: boolean } = { steps: [] },
): Promise<{ readonly root: string; readonly executable: string; readonly directory: string }> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "nyte-cloudflared-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const executable = join(root, "cloudflared");
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require("node:fs");
const path = require("node:path");
const root = ${JSON.stringify(root)};
fs.appendFileSync(path.join(root, "starts"), JSON.stringify({ pid: process.pid, argv: process.argv.slice(2), env: process.env }) + "\\n");
${options.ignoreTerm === true ? 'process.on("SIGTERM", () => {});' : 'process.on("SIGTERM", () => process.exit(0));'}
const steps = ${JSON.stringify(options.steps)};
let index = 0;
const next = () => {
  while (index < steps.length) {
    const step = steps[index];
    if (step.kind === "await") {
      if (!fs.existsSync(path.join(root, step.file))) return setTimeout(next, 10);
    } else if (step.kind === "emit") {
      process.stderr.write(step.line + "\\n");
    } else {
      process.exit(step.code);
    }
    index += 1;
  }
};
next();
setInterval(() => {}, 1000);
`,
  );
  await chmod(executable, 0o755);
  const directory = join(root, "home");
  await prepareConnectorDirectory(directory);

  return { root, executable, directory };
}

interface Start {
  readonly pid: number;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

async function starts(root: string): Promise<readonly Start[]> {
  const path = join(root, "starts");

  if (!existsSync(path)) return [];

  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((entry): Start => JSON.parse(entry));
}

/** Absent, or a zombie waiting to be reaped: either way it runs no more code. */
function running(pid: number): boolean {
  try {
    const state = execFileSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });

    return state.trim() !== "" && !state.trim().startsWith("Z");
  } catch {
    return false;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

const FAST: ConnectorTiming = {
  retryDelaysMs: [10, 10],
  ingressTimeoutMs: 5_000,
  stableMs: 60_000,
  stopTimeoutMs: 1_000,
};

function connector(
  fixture: { readonly executable: string; readonly directory: string },
  timing: ConnectorTiming = FAST,
): CloudflaredConnector {
  const created = new CloudflaredConnector({
    executable: fixture.executable,
    tunnelToken: TOKEN,
    hostname: HOSTNAME,
    port: PORT,
    directory: fixture.directory,
    onChange: () => undefined,
    timing,
  });

  cleanups.push(() => created.stop());

  return created;
}

async function firstStart(root: string): Promise<Start> {
  return vi.waitFor(async () => {
    const [first] = await starts(root);
    assert.ok(first, "cloudflared has not started");

    return first;
  });
}

test("cloudflared gets a fixed environment, the token outside argv, and an explicit config", async () => {
  vi.stubEnv("TUNNEL_LOGLEVEL", "debug");
  vi.stubEnv("TUNNEL_LOGFILE", "/tmp/should-not-exist.log");
  vi.stubEnv("TUNNEL_ORIGIN_CERT", "/tmp/cert.pem");
  const fixture = await standIn();
  connector(fixture).start();
  const { argv, env } = await firstStart(fixture.root);
  const config = join(fixture.directory, "config.yml");

  assert.equal(argv.includes(TOKEN), false);
  assert.deepEqual(argv, [
    "tunnel",
    "--config",
    config,
    "--no-autoupdate",
    "--output",
    "json",
    "--loglevel",
    "info",
    "--transport-loglevel",
    "warn",
    "--metrics",
    "127.0.0.1:0",
    "--management-diagnostics=false",
    "--grace-period",
    "2s",
    "run",
  ]);
  assert.equal(env["TUNNEL_TOKEN"], TOKEN);
  assert.equal(env["HOME"], fixture.directory);
  assert.deepEqual(
    Object.keys(env).filter((key) => key.startsWith("TUNNEL_")),
    ["TUNNEL_TOKEN"],
  );
  assert.equal((await stat(config)).mode & 0o777, 0o600);
  assert.equal((await stat(fixture.directory)).mode & 0o777, 0o700);
  assert.match(await readFile(config, "utf8"), /^loglevel: info$/mu);
});

test("connected waits for verified routes and follows connections as they drop", async () => {
  const fixture = await standIn({
    steps: [
      REGISTERED,
      { kind: "await", file: "routes" },
      // A line past the buffer limit is dropped whole; the next record still counts.
      { kind: "emit", line: "x".repeat(200_000) },
      ROUTED,
      { kind: "await", file: "drop" },
      line({ message: "Connection terminated", connIndex: 0 }),
      { kind: "await", file: "back" },
      REGISTERED,
    ],
  });

  const tunnel = connector(fixture);
  assert.deepEqual(tunnel.status(), { kind: "stopped" });
  tunnel.start();
  await firstStart(fixture.root);
  assert.deepEqual(tunnel.status(), { kind: "connecting" });

  await writeFile(join(fixture.root, "routes"), "");
  await vi.waitFor(() => assert.deepEqual(tunnel.status(), { kind: "connected", connections: 1 }));

  await writeFile(join(fixture.root, "drop"), "");
  await vi.waitFor(() => assert.deepEqual(tunnel.status(), { kind: "connecting" }));

  await writeFile(join(fixture.root, "back"), "");
  await vi.waitFor(() => assert.deepEqual(tunnel.status(), { kind: "connected", connections: 1 }));

  await tunnel.stop();
  assert.deepEqual(tunnel.status(), { kind: "stopped" });
});

test("routes to anything besides this listener end the connector for good", async () => {
  const fixture = await standIn({
    steps: [
      REGISTERED,
      routes([
        { hostname: HOSTNAME, service: `http://127.0.0.1:${String(PORT)}` },
        { hostname: "ssh.example.test", service: "ssh://localhost:22" },
        { service: "http_status:404" },
      ]),
    ],
  });

  const tunnel = connector(fixture);
  tunnel.start();
  const { pid } = await firstStart(fixture.root);

  await vi.waitFor(() =>
    assert.deepEqual(tunnel.status(), { kind: "failed", reason: "ingress_mismatch" }),
  );
  await vi.waitFor(() => assert.equal(alive(pid), false));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await starts(fixture.root)).length, 1);
});

test("a connection whose routes never arrive is ended", async () => {
  const fixture = await standIn({ steps: [REGISTERED] });
  const tunnel = connector(fixture, { ...FAST, ingressTimeoutMs: 100 });
  tunnel.start();
  const { pid } = await firstStart(fixture.root);

  await vi.waitFor(() =>
    assert.deepEqual(tunnel.status(), { kind: "failed", reason: "ingress_unverified" }),
  );
  await vi.waitFor(() => assert.equal(alive(pid), false));
});

test("an unexpected exit is retried within the limit, then reported", async () => {
  const fixture = await standIn({ steps: [{ kind: "exit", code: 1 }] });
  const tunnel = connector(fixture);
  tunnel.start();

  await vi.waitFor(() => assert.deepEqual(tunnel.status(), { kind: "failed", reason: "exited" }));
  assert.equal((await starts(fixture.root)).length, 1 + FAST.retryDelaysMs.length);
});

test("stop ends a cloudflared that ignores SIGTERM by its deadline", async () => {
  const fixture = await standIn({ steps: [], ignoreTerm: true });
  const tunnel = connector(fixture, { ...FAST, stopTimeoutMs: 300 });
  tunnel.start();
  const { pid } = await firstStart(fixture.root);

  const began = Date.now();
  await tunnel.stop();
  assert.ok(Date.now() - began < 3_000, "stop outlived its deadline");
  await vi.waitFor(() => assert.equal(alive(pid), false));
});

test("a supervisor killed on its own still takes cloudflared with it", async () => {
  const fixture = await standIn();
  const tunnel = connector(fixture, { ...FAST, retryDelaysMs: [60_000] });
  tunnel.start();
  const { pid } = await firstStart(fixture.root);

  const supervisor = Number(
    execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim(),
  );

  assert.ok(supervisor > 1);

  process.kill(supervisor, "SIGKILL");
  await vi.waitFor(() => assert.equal(alive(pid), false), { timeout: 3_000 });
  await vi.waitFor(() => assert.equal(tunnel.status().kind, "retrying"));
});

test("stop does not resolve while a cloudflared outlives its killed supervisor", async () => {
  const fixture = await standIn({ steps: [], ignoreTerm: true });
  const tunnel = connector(fixture, { ...FAST, retryDelaysMs: [60_000] });
  tunnel.start();
  const { pid } = await firstStart(fixture.root);

  const supervisor = Number(
    execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" }).trim(),
  );

  process.kill(supervisor, "SIGKILL");
  await tunnel.stop();

  assert.equal(running(pid), false);
});

test.skipIf(process.platform === "win32")(
  "cloudflared ends when the process that started it is killed",
  async () => {
    const fixture = await standIn();

    // A stand-in for the desktop's main process, killed without any chance to clean up.
    const parent = spawn(
      process.execPath,
      [
        "-e",
        `require("node:child_process").spawn("/bin/sh", ["-c", ${JSON.stringify(SUPERVISOR_SCRIPT)}, "nyte-cloudflared", ${JSON.stringify(fixture.executable)}], { detached: true, stdio: ["pipe", "ignore", "ignore"], env: { PATH: "/usr/bin:/bin" } });
setInterval(() => {}, 1000);`,
      ],
      { stdio: "ignore" },
    );

    cleanups.push(() => {
      parent.kill("SIGKILL");
    });
    const { pid } = await firstStart(fixture.root);
    assert.equal(alive(pid), true);

    parent.kill("SIGKILL");
    await vi.waitFor(() => assert.equal(alive(pid), false), { timeout: 3_000 });
  },
);

test("only this hostname, routed to this listener, with a status fallback passes", () => {
  const listener = `http://127.0.0.1:${String(PORT)}`;

  const config = (ingress: readonly IngressRule[], extra = {}) =>
    JSON.stringify({ ingress, ...extra });

  const fallback = { service: "http_status:404" };

  assert.equal(
    routesOnlyTo(config([{ hostname: HOSTNAME, service: listener }, fallback]), HOSTNAME, PORT),
    true,
  );
  assert.equal(
    routesOnlyTo(
      config([{ hostname: "NYTE.example.test", service: listener }, fallback]),
      HOSTNAME,
      PORT,
    ),
    true,
  );

  for (const refused of [
    config([{ hostname: HOSTNAME, service: listener }]),
    config([{ hostname: "other.example.test", service: listener }, fallback]),
    config([{ hostname: HOSTNAME, service: "http://127.0.0.1:1" }, fallback]),
    config([{ hostname: HOSTNAME, service: `http://localhost:${String(PORT)}` }, fallback]),
    config([{ hostname: HOSTNAME, path: "/v1", service: listener }, fallback]),
    config([
      { hostname: HOSTNAME, service: listener, originRequest: { bastionMode: true } },
      fallback,
    ]),
    config([{ hostname: HOSTNAME, service: listener }, { service: "http://127.0.0.1:22" }]),
    config([{ hostname: HOSTNAME, service: listener }, fallback], {
      originRequest: { proxyType: "socks" },
    }),
    "not json",
  ]) {
    assert.equal(routesOnlyTo(refused, HOSTNAME, PORT), false, refused);
  }
});
