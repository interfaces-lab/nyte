import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { afterEach, expect, it, vi } from "vitest";
import { hostFilePath, publishHost } from "../src/host-endpoint.ts";
import { serveHost } from "../src/serve-host.ts";
import type { Served } from "../src/serve-host.ts";

const ENTRY = new URL("./fixtures/count-host.ts", import.meta.url);

const OLDER_BUILD = "older build";

const LineType = Type.Object({ type: Type.String(), url: Type.Optional(Type.String()) });

type Line = Static<typeof LineType>;

const lineChecks = Compile(LineType);

const hostFiles = Compile(Type.Object({ url: Type.String() }));

const folders: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

interface Host {
  readonly name: string;
  readonly lines: string[];
  readonly served: Promise<string>;
  readonly settled: () => boolean;
  readonly url: () => string | undefined;
  stop(): Promise<string>;
}

interface Scene {
  readonly hosts: Host[];
  olderBuild: string | undefined;
}

interface Observed {
  /** Host threads opened so far, at each checkpoint. */
  readonly starts: number[];
  /** Which host `host.json` names, at each checkpoint. */
  readonly named: string[];
  /** The `type` of each line each host wrote to its output, in start order. */
  readonly lines: string[][];
  /** What each `serveHost` returned, in start order. */
  readonly served: string[];
}

function start(scene: Scene, name: string, whenTaken: "wait" | "exit"): Host {
  const stop = new AbortController();
  const lines: string[] = [];
  let done = false;

  const served = serveHost({
    entry: ENTRY,
    log: false,
    whenTaken,
    signal: stop.signal,
    output: { write: (text) => void lines.push(text) },
    listening: (host) => `${JSON.stringify({ type: "listening", ...host })}\n`,
  }).then(
    (result) => describeServed(scene, result),
    (cause: unknown) => `threw: ${cause instanceof Error ? cause.message : String(cause)}`,
  );

  void served.finally(() => {
    done = true;
  });

  const host: Host = {
    name,
    lines,
    served,
    settled: () => done,
    url: () => lineUrl(lines),
    async stop() {
      stop.abort();

      return served;
    },
  };

  scene.hosts.push(host);

  return host;
}

function describeServed(scene: Scene, result: Served): string {
  if (result.kind === "stopped") return "stopped";

  if (result.by === null) return "taken";

  return `taken by ${nameUrl(scene, result.by.url, () => true)}`;
}

function nameUrl(scene: Scene, url: string, serving: (host: Host) => boolean): string {
  if (url === scene.olderBuild) return OLDER_BUILD;

  return scene.hosts.find((host) => serving(host) && host.url() === url)?.name ?? `unknown ${url}`;
}

function lineUrl(lines: readonly string[]): string | undefined {
  const listening = lines.map(parseLine).find((line) => line.type === "listening");

  return listening?.url;
}

function parseLine(text: string): Line {
  const parsed: unknown = JSON.parse(text);

  return lineChecks.Check(parsed) ? parsed : { type: "unknown" };
}

async function listening(host: Host): Promise<void> {
  await vi.waitFor(
    () => {
      if (host.url() === undefined && !host.settled()) throw new Error(`${host.name} not up yet`);
    },
    { timeout: 10_000, interval: 25 },
  );
}

async function checkpoint(scene: Scene, starts: number[], named: string[]): Promise<void> {
  const home = process.env["NYTE_HOME"] ?? "";
  const counted = await readFile(join(home, "starts"), "utf8").catch(() => "");
  starts.push(counted.split("\n").filter((line) => line !== "").length);

  const text = await readFile(hostFilePath(), "utf8").catch(() => null);
  const parsed: unknown = text === null ? null : JSON.parse(text);
  named.push(
    hostFiles.Check(parsed) ? nameUrl(scene, parsed.url, (host) => !host.settled()) : "none",
  );
}

async function observe(scene: Scene, starts: number[], named: string[]): Promise<Observed> {
  const served = await Promise.all(scene.hosts.map((host) => host.stop()));

  return {
    starts,
    named,
    lines: scene.hosts.map((host) => host.lines.map((line) => parseLine(line).type)),
    served,
  };
}

const cases: readonly {
  readonly name: string;
  readonly run: (scene: Scene) => Promise<Observed>;
  readonly expected: Observed;
}[] = [
  {
    name: "two hosts started together on one home open one host thread",
    async run(scene) {
      const first = start(scene, "first", "exit");
      const second = start(scene, "second", "exit");
      const starts: number[] = [];
      const named: string[] = [];
      await Promise.all([listening(first), listening(second)]);
      await checkpoint(scene, starts, named);

      return observe(scene, starts, named);
    },
    expected: {
      starts: [1],
      named: ["first"],
      lines: [["listening"], []],
      served: ["stopped", "taken"],
    },
  },
  {
    name: "an exit host while one serves returns taken, naming the serving host",
    async run(scene) {
      const first = start(scene, "first", "exit");
      await listening(first);
      const second = start(scene, "second", "exit");
      await second.served;
      const starts: number[] = [];
      const named: string[] = [];
      await checkpoint(scene, starts, named);

      return observe(scene, starts, named);
    },
    expected: {
      starts: [1],
      named: ["first"],
      lines: [["listening"], []],
      served: ["stopped", "taken by first"],
    },
  },
  {
    name: "a wait host stands by while one serves, then serves once it stops",
    async run(scene) {
      const first = start(scene, "first", "exit");
      await listening(first);
      const second = start(scene, "second", "wait");
      const starts: number[] = [];
      const named: string[] = [];
      await sleep(2_500);
      await checkpoint(scene, starts, named);
      await first.stop();
      await listening(second);
      await checkpoint(scene, starts, named);

      return observe(scene, starts, named);
    },
    expected: {
      starts: [1, 2],
      named: ["first", "second"],
      lines: [["listening"], ["standby", "listening"]],
      served: ["stopped", "stopped"],
    },
  },
  {
    name: "an older build's live host.json, held without the lock, turns an exit host away",
    async run(scene) {
      const older = createServer((_request, response) => response.end("{}"));
      await new Promise<void>((resolve) => older.listen(0, "127.0.0.1", resolve));
      const address = older.address();

      if (address === null || typeof address === "string") throw new Error("No TCP address.");
      scene.olderBuild = `http://127.0.0.1:${String(address.port)}`;
      await publishHost(hostFilePath(), {
        url: scene.olderBuild,
        token: "older",
        pid: process.pid,
      });
      const second = start(scene, "second", "exit");
      await second.served;
      const starts: number[] = [];
      const named: string[] = [];
      await checkpoint(scene, starts, named);
      const observed = await observe(scene, starts, named);
      older.close();

      return observed;
    },
    expected: {
      starts: [0],
      named: [OLDER_BUILD],
      lines: [[]],
      served: [`taken by ${OLDER_BUILD}`],
    },
  },
];

it.each(cases)("$name", { timeout: 30_000 }, async (scenario) => {
  const home = await mkdtemp(join(tmpdir(), "nyte-serve-host-"));
  folders.push(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("NYTE_HOME", home);

  expect(await scenario.run({ hosts: [], olderBuild: undefined })).toEqual(scenario.expected);
});
