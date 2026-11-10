import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { setTimeout as sleep } from "node:timers/promises";
import { asId } from "@nyte-ai/schema";
import type { Execution, JobView, RunView } from "@nyte-ai/schema";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";
import { afterEach, expect, it, vi } from "vitest";
import { hostFaultsPath, hostFilePath, hostRetirePath, publishHost } from "../src/host-endpoint.ts";
import type { Supervisor } from "../src/host-thread.ts";
import { hostIdle, requestRetire, retireOnRequest } from "../src/outdated-host.ts";
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
  vi.useRealTimers();
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
  readonly starts: number[];
  readonly named: string[];
  readonly lines: string[][];
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
    supervisor: null,
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

it("a host thread that dies after listening leaves its faults and its death in the fault log", async () => {
  const home = await mkdtemp(join(tmpdir(), "nyte-serve-host-"));
  folders.push(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("NYTE_HOME", home);

  await expect(
    serveHost({
      entry: new URL("./fixtures/fault-host.ts", import.meta.url),
      log: false,
      whenTaken: "exit",
      supervisor: null,
      signal: new AbortController().signal,
      output: { write: () => undefined },
      listening: () => "",
    }),
  ).rejects.toThrow("The host stopped: boom");

  const lines = (await readFile(hostFaultsPath(), "utf8"))
    .split("\n")
    .filter((line) => line !== "");

  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(
    /^\d{4}-\d\d-\d\dT[\d:.]+Z \[lease\] lost \{"what":"main","reason":"lapsed"\}$/u,
  );
  expect(lines[1]).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z \[host\] stopped \{"error":"Error: boom/u);
});

it("a supervised host asked to retire stops serving, withdraws host.json and writes no fault", async () => {
  const home = await mkdtemp(join(tmpdir(), "nyte-serve-host-"));
  folders.push(home);
  vi.stubEnv("HOME", home);
  vi.stubEnv("NYTE_HOME", home);
  const lines: string[] = [];

  const served = serveHost({
    entry: new URL("./fixtures/replace-host.ts", import.meta.url),
    log: false,
    whenTaken: "exit",
    supervisor: "nyte",
    signal: new AbortController().signal,
    output: { write: (text) => void lines.push(text) },
    listening: () => "listening",
  });

  await vi.waitFor(() => expect(lines).toEqual(["listening"]), { timeout: 10_000, interval: 25 });
  await requestRetire("nyte");

  expect(await served).toEqual({ kind: "stopped" });
  expect(await readFile(hostFilePath(), "utf8").catch(() => "none")).toBe("none");
  expect(await readFile(hostFaultsPath(), "utf8").catch(() => "none")).toBe("none");
});

const RUN: RunView = {
  id: asId("run"),
  head: asId("main"),
  startedAt: 0,
  attempt: 1,
  origin: { kind: "input", message: asId("message") },
};

const running = { state: { kind: "running" }, pty: null } as const;

const terminal = { columns: 80, rows: 24, shell: "/bin/zsh" };

const idleCases: readonly {
  readonly name: string;
  readonly execution: Execution;
  readonly jobs: readonly Pick<JobView, "state" | "pty">[];
  readonly idle: boolean;
}[] = [
  {
    name: "a live run",
    execution: { kind: "live", run: RUN, phase: "responding", stopping: false },
    jobs: [],
    idle: false,
  },
  {
    name: "a retrying run",
    execution: { kind: "retrying", run: RUN, until: 0, reason: "overloaded" },
    jobs: [],
    idle: false,
  },
  {
    name: "a run waiting on the user",
    execution: { kind: "waiting", run: RUN, on: { kind: "part", part: asId("part") } },
    jobs: [],
    idle: true,
  },
  {
    name: "a run waiting on a timer",
    execution: { kind: "waiting", run: RUN, on: { kind: "timer", until: 0 } },
    jobs: [],
    idle: true,
  },
  {
    name: "a running job",
    execution: { kind: "idle", lastRun: null },
    jobs: [running],
    idle: false,
  },
  {
    name: "a terminal, even at its prompt",
    execution: { kind: "idle", lastRun: null },
    jobs: [{ ...running, pty: terminal }],
    idle: false,
  },
  {
    name: "nothing",
    execution: { kind: "idle", lastRun: null },
    jobs: [{ state: { kind: "exited", code: 0, reason: "exited" }, pty: null }],
    idle: true,
  },
];

it("only a live or retrying run or a running job, terminals included, keeps a host from being replaced", () => {
  expect(
    idleCases.map((row) => ({
      name: row.name,
      idle: hostIdle([{ heads: [{ execution: row.execution }] }], row.jobs),
    })),
  ).toEqual(idleCases.map((row) => ({ name: row.name, idle: row.idle })));
});

type Asker = "this process" | "a dead process";

const RUNNING_JOB: JobView = {
  id: asId("job"),
  command: "pnpm dev",
  title: "pnpm dev",
  session: null,
  pty: null,
  state: { kind: "running" },
  startedAt: 0,
  endedAt: null,
  tail: "",
  foreground: false,
};

const retireCases: readonly {
  readonly name: string;
  readonly supervisor: Supervisor | null;
  readonly asker: Asker;
  readonly asks: Supervisor;
  readonly busy: boolean;
  readonly retired: number;
  readonly left: readonly Asker[];
}[] = [
  {
    name: "an idle host asked by a live process of its kind",
    supervisor: "nyte",
    asker: "this process",
    asks: "nyte",
    busy: false,
    retired: 1,
    left: [],
  },
  {
    name: "a busy host",
    supervisor: "nyte",
    asker: "this process",
    asks: "nyte",
    busy: true,
    retired: 0,
    left: ["this process"],
  },
  {
    name: "a request from a dead process",
    supervisor: "nyte",
    asker: "a dead process",
    asks: "nyte",
    busy: false,
    retired: 0,
    left: [],
  },
  {
    name: "a request of the other kind",
    supervisor: "launchd",
    asker: "this process",
    asks: "nyte",
    busy: false,
    retired: 0,
    left: ["this process"],
  },
  {
    name: "a host with no supervisor",
    supervisor: null,
    asker: "this process",
    asks: "nyte",
    busy: false,
    retired: 0,
    left: ["this process"],
  },
];

it("a host retires only when it is idle and a live process of its supervisor's kind asks", async () => {
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;

  const outcomes: { readonly name: string; readonly retired: number; readonly left: Asker[] }[] =
    [];

  for (const row of retireCases) {
    const home = await mkdtemp(join(tmpdir(), "nyte-retire-"));
    folders.push(home);
    vi.stubEnv("NYTE_HOME", home);

    if (row.asker === "this process") await requestRetire(row.asks);
    else {
      await mkdir(hostRetirePath(), { recursive: true });
      await writeFile(join(hostRetirePath(), String(dead)), row.asks);
    }

    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let retired = 0;

    const host = {
      sessions: { list: async () => ({ items: [], next: null }) },
      workspaces: { list: async () => [{ id: asId<"workspace">("home") }] },
      workspace: () => ({ jobs: { list: async () => (row.busy ? [RUNNING_JOB] : []) } }),
    };

    const stop = retireOnRequest(host, row.supervisor, () => {
      retired += 1;
    });

    const scheduled = vi.getTimerCount();
    await vi.advanceTimersByTimeAsync(10_000);
    await until(() => retired > 0 || vi.getTimerCount() === scheduled);
    stop();
    vi.useRealTimers();
    const left = await readdir(hostRetirePath());

    outcomes.push({
      name: row.name,
      retired,
      left: left.map((name) => (name === String(dead) ? "a dead process" : "this process")),
    });
  }

  expect(outcomes).toEqual(
    retireCases.map((row) => ({ name: row.name, retired: row.retired, left: row.left })),
  );
});

async function until(done: () => boolean): Promise<void> {
  for (let tries = 0; !done(); tries++) {
    if (tries > 200) throw new Error("Timed out waiting for a check.");
    await sleep(10);
  }
}
