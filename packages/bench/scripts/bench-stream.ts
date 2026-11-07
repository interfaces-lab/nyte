/**
 * Host CPU per streamed text patch. A real host (`openHost`) on the memory store streams
 * scripted replies of many small chunks into K sessions at once, each with H prior messages
 * on its head, with or without one subscribed socket client per session.
 *
 * Each run is timed from the moment every session has streamed its first chunk until the first
 * one streams its last, so no run start or end falls inside the window.
 *
 * --delta-ms 0 keeps the loop busy: the model yields one macrotask per chunk instead of sleeping,
 * since without it the model pushes every chunk before the host takes the first.
 *
 * --profile writes a V8 CPU profile of the measured runs per row, and `<name>.windows.json` with
 * hrtime µs: `started` when the profile began and each run's window, so a reader can keep only
 * streaming samples. `Profiler.start` resolves up to ~1 s after the profile's own start time.
 *
 * pnpm --dir packages/bench bench:stream [--runs 20] [--warmup 3] [--chunks 400] [--delta-ms 1]
 *   [--k 1,4,8] [--h 0,200,2000] [--client both|yes|no] [--profile file.cpuprofile]
 *
 * The clients run in a child process, so the host's `process.cpuUsage()` counts only the host.
 * "proc" is the host process's CPU over the streaming window per patch, every thread; "main" is the
 * event-loop thread's (`process.threadCpuUsage()`), which bounds patches per second on one loop.
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { Session as Inspector } from "node:inspector/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { memoryStore } from "@nyte-ai/core/store";
import type { Session } from "@nyte-ai/core";
import { openHost } from "@nyte-ai/host";
import { encodeInput, openHostSocket } from "@nyte-ai/protocol";
import { asId, SOCKET_PATH } from "@nyte-ai/schema";
import WebSocket from "ws";
import { fakeModels, titleReply } from "../src/index.ts";
import type { Reply } from "../src/index.ts";

const SELF = fileURLToPath(import.meta.url);

const parsed = parseArgs({
  allowPositionals: true,
  options: {
    runs: { type: "string", default: "20" },
    warmup: { type: "string", default: "3" },
    chunks: { type: "string", default: "400" },
    "delta-ms": { type: "string", default: "1" },
    k: { type: "string", default: "1,4,8" },
    h: { type: "string", default: "0,200,2000" },
    client: { type: "string", default: "both" },
    profile: { type: "string" },
    "client-mode": { type: "boolean", default: false },
  },
});

/** Re-runs this script with its own HOME and NYTE_HOME so nothing touches the user's host. */
async function isolate(): Promise<void> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-bench-stream-")));

  const child = spawn(process.execPath, [...process.execArgv, SELF, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: {
      ...process.env,
      HOME: home,
      NYTE_HOME: join(home, ".nyte"),
      NYTE_BENCH_HOME: home,
    },
  });

  const code = await new Promise<number>((resolve) =>
    child.once("exit", (exit) => resolve(exit ?? 1)),
  );

  await rm(home, { recursive: true, force: true, maxRetries: 10 });
  process.exit(code);
}

async function bench(): Promise<void> {
  const runs = Number(parsed.values.runs);
  const warmup = Number(parsed.values.warmup);
  const chunks = Number(parsed.values.chunks);
  const deltaMs = Number(parsed.values["delta-ms"]);
  const ks = parsed.values.k.split(",").map(Number);
  const hs = parsed.values.h.split(",").map(Number);

  const clientModes =
    parsed.values.client === "both" ? [false, true] : [parsed.values.client === "yes"];

  const width = Math.max(...ks);
  const home = process.env.NYTE_BENCH_HOME ?? tmpdir();
  const workspace = join(home, "workspace");
  await mkdir(workspace, { recursive: true });

  const text = "word ".repeat(chunks);
  let measured: (() => (streamed: number) => Promise<void> | void) | null = null;

  const fake = fakeModels({
    fallback: (request): Reply => {
      const title = titleReply(request);

      if (title !== null) return { content: [{ type: "text", text: title }] };

      if (measured === null) return { content: [{ type: "text", text: "Seeded reply." }] };

      return {
        content: [{ type: "text", text }],
        tokens: chunks,
        timing: { deltaMs },
        tap: measured(),
      };
    },
  });

  const host = await openHost({
    store: memoryStore(),
    models: fake.models,
    workspace: { kind: "local", path: workspace },
    home,
  });

  const token = crypto.randomUUID();

  const listener = await host.listen({
    transport: { kind: "http", hostname: "127.0.0.1", port: 0 },
    auth: { kind: "token", token },
  });

  if (listener.address === null) throw new Error("The host has no address.");
  const address = listener.address;

  const seeded = new Map<number, Session[]>();

  for (const h of hs) {
    const started = performance.now();
    seeded.set(h, await Promise.all(Array.from({ length: width }, () => seed(h))));
    process.stderr.write(
      `seeded ${width} sessions with ${h} messages in ${Math.round(performance.now() - started)} ms\n`,
    );
  }

  const rows: Row[] = [];
  const inspector = parsed.values.profile === undefined ? null : new Inspector();

  if (inspector !== null) {
    inspector.connect();
    await inspector.post("Profiler.enable");
    await inspector.post("Profiler.setSamplingInterval", { interval: 100 });
  }

  for (const h of hs)
    for (const withClient of clientModes)
      for (const k of ks) {
        const sessions = (seeded.get(h) ?? []).slice(0, k);
        const clients = withClient ? await openClients(address, token, sessions) : null;
        const samples: Sample[] = [];
        let profiled = 0;

        for (let index = 0; index < warmup + runs; index += 1) {
          const profiling = inspector !== null && index === warmup;

          if (profiling) {
            await inspector.post("Profiler.start");
            profiled = Number(process.hrtime.bigint() / 1000n);
          }

          const sample = await streamOnce(sessions);

          if (index >= warmup) samples.push(sample);
        }

        if (inspector !== null) {
          const { profile } = await inspector.post("Profiler.stop");
          const name = `${parsed.values.profile}.k${k}-h${h}-${withClient ? "client" : "none"}`;
          await writeFile(`${name}.cpuprofile`, JSON.stringify(profile));
          await writeFile(
            `${name}.windows.json`,
            JSON.stringify({
              started: profiled,
              windows: samples.map((sample) => [sample.from, sample.to]),
            }),
          );
        }

        const frames = clients === null ? null : await clients.close();
        rows.push(summarize(k, h, withClient, samples, frames));
        process.stderr.write(`${formatRow(rows.at(-1))}\n`);
      }

  process.stdout.write(
    `\nchunks per reply ${chunks}, delta ${deltaMs} ms, runs ${runs} after ${warmup} warmup, node ${process.version}\n\n`,
  );
  process.stdout.write(`${formatTable(rows)}\n`);
  inspector?.disconnect();
  await host.close();
  process.exit(0);

  async function seed(h: number): Promise<Session> {
    const exchanges = Math.max(1, Math.ceil(h / 2));
    const { session, receipt } = await host.sessions.start({ content: "Seed 0." });
    await receipt.settled();

    for (let index = 1; index < exchanges; index += 1)
      await (await session.send(`Seed ${index}.`)).settled();

    return session;
  }

  async function streamOnce(sessions: readonly Session[]): Promise<Sample> {
    const gate = Promise.withResolvers<void>();
    const lanes: { streamed: number }[] = [];

    const window: Timing = { begin: null, end: null };

    measured = () => {
      const lane = { streamed: 0 };
      lanes.push(lane);

      return (streamed) => {
        lane.streamed = streamed;

        if (streamed === 1) {
          if (lanes.length === sessions.length && lanes.every((each) => each.streamed >= 1)) {
            window.begin = mark();
            gate.resolve();
          }

          return gate.promise;
        }

        if (streamed === chunks && window.end === null)
          window.end = {
            mark: mark(),
            patches: lanes.reduce((sum, each) => sum + each.streamed - 1, 0),
          };

        return deltaMs === 0 ? new Promise((resolve) => setImmediate(resolve)) : undefined;
      };
    };

    await Promise.all(sessions.map(async (session) => (await session.send("Go.")).settled()));
    measured = null;

    const from = window.begin;
    const end = window.end;

    if (from === null || end === null) throw new Error("A reply never streamed all its chunks.");
    const to = end.mark;
    const cpu = to.cpu.user + to.cpu.system - from.cpu.user - from.cpu.system;
    const thread = to.thread.user + to.thread.system - from.thread.user - from.thread.system;
    const system = to.cpu.system - from.cpu.system;
    const elu = performance.eventLoopUtilization(to.elu, from.elu);

    return {
      patches: end.patches,
      cpuMicros: cpu,
      threadMicros: thread,
      systemMicros: system,
      wallMs: to.wall - from.wall,
      elu: elu.utilization,
      from: from.hrtime,
      to: to.hrtime,
    };
  }
}

type Timing = {
  begin: Mark | null;
  end: { readonly mark: Mark; readonly patches: number } | null;
};

type Mark = {
  readonly cpu: NodeJS.CpuUsage;
  readonly thread: NodeJS.CpuUsage;
  readonly elu: ReturnType<typeof performance.eventLoopUtilization>;
  readonly wall: number;
  readonly hrtime: number;
};

function mark(): Mark {
  return {
    cpu: process.cpuUsage(),
    thread: process.threadCpuUsage(),
    elu: performance.eventLoopUtilization(),
    wall: performance.now(),
    hrtime: Number(process.hrtime.bigint() / 1000n),
  };
}

type Sample = {
  readonly patches: number;
  readonly cpuMicros: number;
  readonly threadMicros: number;
  readonly systemMicros: number;
  readonly wallMs: number;
  readonly from: number;
  readonly to: number;
  readonly elu: number;
};

type Row = {
  readonly k: number;
  readonly h: number;
  readonly client: boolean;
  readonly runs: number;
  readonly p10: number;
  readonly median: number;
  readonly p90: number;
  readonly perSecond: number;
  readonly thread: number;
  readonly system: number;
  readonly offered: number;
  readonly elu: number;
  readonly frames: number | null;
};

function summarize(
  k: number,
  h: number,
  client: boolean,
  samples: readonly Sample[],
  frames: number | null,
): Row {
  const perPatch = samples.map((sample) => sample.cpuMicros / sample.patches).sort((a, b) => a - b);

  const offered = samples
    .map((sample) => sample.patches / (sample.wallMs / 1000))
    .sort((a, b) => a - b);

  const elu = samples.map((sample) => sample.elu).sort((a, b) => a - b);
  const median = quantile(perPatch, 0.5);

  const thread = samples
    .map((sample) => sample.threadMicros / sample.patches)
    .sort((a, b) => a - b);

  const system = samples
    .map((sample) => sample.systemMicros / sample.patches)
    .sort((a, b) => a - b);

  return {
    k,
    h,
    client,
    runs: samples.length,
    p10: quantile(perPatch, 0.1),
    median,
    p90: quantile(perPatch, 0.9),
    perSecond: 1_000_000 / quantile(thread, 0.5),
    thread: quantile(thread, 0.5),
    system: quantile(system, 0.5),
    offered: quantile(offered, 0.5),
    elu: quantile(elu, 0.5),
    frames,
  };
}

function quantile(sorted: readonly number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);

  return (sorted[low] ?? 0) + ((sorted[high] ?? 0) - (sorted[low] ?? 0)) * (at - low);
}

const COLUMNS = [
  "K",
  "H",
  "client",
  "proc µs med",
  "p10",
  "p90",
  "runs",
  "main µs med",
  "sys µs med",
  "patches/s main",
  "patches/s seen",
  "ELU",
  "text frames",
];

function formatRow(row: Row | undefined): string {
  if (row === undefined) return "";

  return [
    row.k,
    row.h,
    row.client ? "yes" : "no",
    row.median.toFixed(1),
    row.p10.toFixed(1),
    row.p90.toFixed(1),
    row.runs,
    row.thread.toFixed(1),
    row.system.toFixed(1),
    Math.round(row.perSecond),
    Math.round(row.offered),
    row.elu.toFixed(2),
    row.frames ?? "-",
  ].join("\t");
}

function formatTable(rows: readonly Row[]): string {
  const cells = [COLUMNS, ...rows.map((row) => formatRow(row).split("\t"))];

  const widths = COLUMNS.map((_, column) =>
    Math.max(...cells.map((line) => String(line[column]).length)),
  );

  return cells
    .map((line) =>
      line.map((cell, column) => String(cell).padStart(widths[column] ?? 0)).join("  "),
    )
    .join("\n");
}

async function openClients(
  address: string,
  token: string,
  sessions: readonly Session[],
): Promise<{ close(): Promise<number> }> {
  const child = spawn(
    process.execPath,
    [
      SELF,
      "--client-mode",
      address,
      token,
      ...sessions.flatMap((session) => [session.id, session.name]),
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );

  const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const ready = await lines.next();

  if (ready.value !== "ready") throw new Error(`The client process said ${String(ready.value)}.`);

  return {
    async close() {
      child.stdin.end();
      const counted = await lines.next();
      await new Promise((resolve) => child.once("exit", resolve));

      return Number(String(counted.value).replace("frames ", ""));
    },
  };
}

/** The client side: one socket per session, subscribed and reading its head the way the app does. */
async function runClients(positionals: readonly string[]): Promise<void> {
  const [address = "", token = "", ...pairs] = positionals;
  const url = new URL(SOCKET_PATH, address);
  url.protocol = "ws:";
  let frames = 0;

  const sockets = await Promise.all(
    Array.from({ length: pairs.length / 2 }, async (_, index) => {
      const session = pairs[index * 2] ?? "";
      const head = pairs[index * 2 + 1] ?? "";

      const socket = await openHostSocket({
        socket: new WebSocket(url.href, { headers: { Authorization: `Bearer ${token}` } }),
        client: { kind: "other", name: "bench-stream", version: "0.0.0", actions: [] },
      });

      socket.onText(() => {
        frames += 1;
      });
      await socket.call("events.subscribe", { scopes: [`session/${session}`] });
      await socket.call(
        "head.read",
        encodeInput("head.read", {
          session: asId<"session">(session),
          head: asId<"head">(head),
          window: { tail: 200 },
        }),
      );
      await socket.call("text.open", {});

      return socket;
    }),
  );

  process.stdout.write("ready\n");

  for await (const line of createInterface({ input: process.stdin })) void line;

  for (const socket of sockets) socket.close();
  process.stdout.write(`frames ${frames}\n`);
  process.exit(0);
}

if (parsed.values["client-mode"]) await runClients(parsed.positionals);
else if (process.env.NYTE_BENCH_HOME === undefined) await isolate();
else await bench();
