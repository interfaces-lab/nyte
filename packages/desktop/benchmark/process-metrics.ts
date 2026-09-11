import type { ElectronApplication } from "@playwright/test";
import { execFile } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const ElectronProcess = Type.Object({
  pid: Type.Number({ minimum: 1 }),
  type: Type.String({ minLength: 1 }),
  cpuPercent: Type.Number({ minimum: 0 }),
  idleWakeupsPerSecond: Type.Number({ minimum: 0 }),
  rssBytes: Type.Number({ minimum: 0 }),
});
const ElectronProcesses = Type.Array(ElectronProcess);

type ElectronProcess = Static<typeof ElectronProcess>;

export interface ProcessTreeEntry {
  readonly pid: number;
  readonly parentPid: number;
  readonly rssBytes: number;
  readonly command: string;
}

interface DarwinActivity {
  readonly cpuPercent: number;
  readonly power: number;
}

export interface ProcessMetricSample {
  readonly elapsedMs: number;
  readonly cpuPercent: number;
  readonly idleWakeupsPerSecond: number;
  readonly rssBytes: number;
  readonly power: number | null;
  readonly electronProcesses: readonly ElectronProcess[];
  readonly processCount: number;
}

export interface NumericSummary {
  readonly count: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
}

export interface ProcessMetricsReport {
  readonly schemaVersion: 1;
  readonly intervalMs: number;
  readonly samples: readonly ProcessMetricSample[];
  readonly summary: {
    readonly cpuPercent: NumericSummary;
    readonly idleWakeupsPerSecond: NumericSummary;
    readonly rssBytes: NumericSummary;
    readonly power: NumericSummary | null;
  };
  readonly methodology: {
    readonly processScope: "Full process tree where ps is available; Electron processes otherwise";
    readonly cpu: "macOS top across the process tree; Electron app metrics elsewhere";
    readonly idleWakeups: "Electron app metrics";
    readonly energy: "macOS top POWER energy-impact proxy; unavailable on other platforms";
    readonly quantiles: "nearest-rank";
  };
}

export interface ProcessMetricsSampling {
  stop(): Promise<ProcessMetricsReport>;
}

function run(file: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null) {
          reject(new Error(`${file} failed: ${stderr.trim() || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

export function parseProcessList(output: string): ProcessTreeEntry[] {
  return output
    .split(/\r?\n/u)
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/u.exec(line);
      if (match === null) throw new Error(`Invalid ps row: ${line}`);
      const [pid, parentPid, rssKiB] = match.slice(1, 4).map(Number);
      const command = match[4];
      if (
        pid === undefined ||
        parentPid === undefined ||
        rssKiB === undefined ||
        command === undefined ||
        !Number.isSafeInteger(pid) ||
        pid <= 0 ||
        !Number.isSafeInteger(parentPid) ||
        parentPid < 0 ||
        !Number.isSafeInteger(rssKiB) ||
        rssKiB < 0
      ) {
        throw new Error(`Invalid ps row: ${line}`);
      }
      return { pid, parentPid, rssBytes: rssKiB * 1024, command };
    });
}

export function processTree(
  processes: readonly ProcessTreeEntry[],
  rootPid: number,
): ProcessTreeEntry[] {
  const root = processes.find((process) => process.pid === rootPid);
  if (root === undefined) return [];
  const found: ProcessTreeEntry[] = [];
  const pending = [root];
  const seen = new Set<number>();
  while (pending.length > 0) {
    const process = pending.shift();
    if (process === undefined || seen.has(process.pid)) continue;
    seen.add(process.pid);
    found.push(process);
    pending.push(...processes.filter((candidate) => candidate.parentPid === process.pid));
  }
  return found;
}

export async function readProcessTree(rootPid: number): Promise<ProcessTreeEntry[]> {
  if (process.platform === "win32") return [];
  return processTree(
    parseProcessList(await run("/bin/ps", ["-axo", "pid=,ppid=,rss=,comm="])),
    rootPid,
  );
}

/** Read the final table from `top -l 2 -stats pid,cpu,power`; the first table is unprimed. */
export function parseDarwinActivity(
  output: string,
  pids: ReadonlySet<number>,
): DarwinActivity | null {
  let table = false;
  const activity = new Map<number, DarwinActivity>();
  for (const line of output.split(/\r?\n/u)) {
    if (/^PID\s+%CPU\s+POWER\s*$/u.test(line.trim())) {
      table = true;
      activity.clear();
      continue;
    }
    if (!table || line.trim() === "") continue;
    const match = /^\s*(\d+)\s+([\d.]+)\s+([\d.]+)\s*$/u.exec(line);
    if (match === null) {
      table = false;
      continue;
    }
    const pid = Number(match[1]);
    const cpuPercent = Number(match[2]);
    const power = Number(match[3]);
    if (pids.has(pid) && Number.isFinite(cpuPercent) && Number.isFinite(power)) {
      activity.set(pid, { cpuPercent, power });
    }
  }
  if (activity.size === 0) return null;
  return [...activity.values()].reduce(
    (total, value) => ({
      cpuPercent: total.cpuPercent + value.cpuPercent,
      power: total.power + value.power,
    }),
    { cpuPercent: 0, power: 0 },
  );
}

function summary(values: readonly number[]): NumericSummary {
  const sorted = [...values].sort((left, right) => left - right);
  const p50 = sorted[Math.ceil(sorted.length * 0.5) - 1];
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  if (p50 === undefined || p95 === undefined) throw new Error("A metric report needs one sample");
  return {
    count: sorted.length,
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50,
    p95,
  };
}

async function sample(
  application: ElectronApplication,
  rootPid: number,
  started: number,
  includePower: boolean,
): Promise<ProcessMetricSample> {
  const tree = await readProcessTree(rootPid);
  let activity: DarwinActivity | null = null;
  if (includePower && process.platform === "darwin" && tree.length > 0) {
    const args = ["-l", "2", "-s", "1", "-stats", "pid,cpu,power"];
    for (const process of tree) args.push("-pid", String(process.pid));
    activity = parseDarwinActivity(
      await run("/usr/bin/top", args),
      new Set(tree.map((process) => process.pid)),
    );
  }
  const raw: unknown = await application.evaluate(({ app }) =>
    app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      cpuPercent: metric.cpu.percentCPUUsage,
      idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
      rssBytes: metric.memory.workingSetSize * 1024,
    })),
  );
  const electronProcesses = Value.Parse(ElectronProcesses, raw);
  const latestTree = await readProcessTree(rootPid);
  const electronCpuPercent = electronProcesses.reduce(
    (total, process) => total + process.cpuPercent,
    0,
  );
  return {
    elapsedMs: performance.now() - started,
    cpuPercent: activity?.cpuPercent ?? electronCpuPercent,
    idleWakeupsPerSecond: electronProcesses.reduce(
      (total, process) => total + process.idleWakeupsPerSecond,
      0,
    ),
    rssBytes:
      latestTree.length === 0
        ? electronProcesses.reduce((total, process) => total + process.rssBytes, 0)
        : latestTree.reduce((total, process) => total + process.rssBytes, 0),
    power: activity?.power ?? null,
    electronProcesses,
    processCount: latestTree.length === 0 ? electronProcesses.length : latestTree.length,
  };
}

export async function startProcessMetricsSampling(
  application: ElectronApplication,
  intervalMs: number,
): Promise<ProcessMetricsSampling> {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0)
    throw new Error("Sample interval must be positive");
  const rootPid = application.process().pid;
  if (rootPid === undefined) throw new Error("Electron did not expose its process id");
  await application.evaluate(({ app }) => {
    app.getAppMetrics();
  });
  const started = performance.now();
  const samples: ProcessMetricSample[] = [];
  let stopping = false;
  let sampling = false;
  const takeSample = async (includePower: boolean): Promise<void> => {
    sampling = true;
    try {
      samples.push(await sample(application, rootPid, started, includePower));
    } finally {
      sampling = false;
    }
  };
  let pending = takeSample(true);
  const loop = async (): Promise<void> => {
    await pending;
    while (!stopping) {
      await delay(intervalMs);
      if (stopping) break;
      pending = takeSample(true);
      await pending;
    }
  };
  const running = loop();
  let report: Promise<ProcessMetricsReport> | undefined;
  return {
    stop() {
      report ??= (async () => {
        const sampleInFlight = sampling;
        stopping = true;
        await running;
        if (!sampleInFlight) await takeSample(false);
        const power = samples.flatMap((value) => (value.power === null ? [] : [value.power]));
        return {
          schemaVersion: 1,
          intervalMs,
          samples,
          summary: {
            cpuPercent: summary(samples.map((value) => value.cpuPercent)),
            idleWakeupsPerSecond: summary(samples.map((value) => value.idleWakeupsPerSecond)),
            rssBytes: summary(samples.map((value) => value.rssBytes)),
            power: power.length === 0 ? null : summary(power),
          },
          methodology: {
            processScope: "Full process tree where ps is available; Electron processes otherwise",
            cpu: "macOS top across the process tree; Electron app metrics elsewhere",
            idleWakeups: "Electron app metrics",
            energy: "macOS top POWER energy-impact proxy; unavailable on other platforms",
            quantiles: "nearest-rank",
          },
        };
      })();
      return report;
    },
  };
}
