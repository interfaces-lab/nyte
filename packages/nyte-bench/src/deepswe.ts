import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { appendFile, mkdir, open, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { simulate } from "@nyte-ai/bench";
import { isPart, tool } from "@nyte-ai/core";
import { ThinkingType } from "@nyte-ai/schema";
import type { ModelRef, Thinking } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  cloneApp,
  containerExec,
  docker,
  extractApp,
  removeContainer,
  startContainer,
} from "./container.ts";
import { openCatalog, parseModel } from "./models.ts";
import type { ModelsFactory } from "./models.ts";
import { pool } from "./pool.ts";
import { settle } from "./sample.ts";
import { meterUsage } from "./usage.ts";

const USAGE =
  "Usage: pnpm --dir packages/nyte-bench deepswe --dataset <deep-swe/tasks> --out <dir> [--task id]... [--count n] [--attempts n] [--model provider/id] [--thinking level] [--concurrency n] [--timeout s]\n";

/** The tasks a run picks when it names none: the first `--count` by this seed's hash, so every run of the same dataset draws the same set. */
const SELECTION_SEED = "nyte-deepswe-12";

/** Built-in plugins a DeepSWE run turns off: web search could find the upstream change, and the Claude Code and ACP runtimes would run on this Mac, outside the task container. */
const DISABLED = ["web", "claude-code-sdk", "acp"];

const Reward = Type.Object({
  reward: Type.Number(),
  partial: Type.Optional(Type.Number()),
  apply_failed: Type.Optional(Type.Number()),
});

interface Task {
  readonly id: string;
  readonly folder: string;
  readonly language: string;
  readonly image: string;
  readonly collect: string;
}

interface Job {
  readonly task: Task;
  readonly attempt: number;
}

/** One attempt, as a line of `results.jsonl`. */
interface Attempt {
  readonly task: string;
  readonly language: string;
  readonly attempt: number;
  readonly model: string;
  readonly thinking: Thinking;
  /** 1 when the verifier passed, 0 when it failed, null when the verifier itself crashed. */
  readonly reward: number | null;
  readonly partial: number | null;
  readonly applyFailed: boolean;
  readonly timedOut: boolean;
  readonly error: string | null;
  readonly agentMs: number;
  readonly requests: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  /** Input tokens of the chat's first request: the fixed prompt, the tool definitions and the task. */
  readonly firstRequestTokens: number | null;
  readonly toolCalls: Readonly<Record<string, number>>;
  readonly failedCalls: number;
  readonly patchBytes: number;
}

const args = parseArgs({
  options: {
    dataset: { type: "string" },
    out: { type: "string" },
    task: { type: "string", multiple: true },
    count: { type: "string", default: "12" },
    attempts: { type: "string", default: "3" },
    model: { type: "string", default: "anthropic/claude-sonnet-5-5" },
    thinking: { type: "string", default: "high" },
    concurrency: { type: "string", default: "2" },
    timeout: { type: "string", default: "1200" },
  },
});

const dataset = args.values.dataset;

const out = args.values.out;

const thinking = args.values.thinking;

if (dataset === undefined || out === undefined || !Value.Check(ThinkingType, thinking)) {
  process.stderr.write(USAGE);
  process.exit(1);
}

const all = await loadTasks(resolve(dataset));

const named = args.values.task;

const tasks =
  named === undefined
    ? [...all]
        .sort((a, b) => seedHash(a.id).localeCompare(seedHash(b.id)))
        .slice(0, Number(args.values.count))
    : named.map((id) => {
        const found = all.find((task) => task.id === id);

        if (found === undefined) throw new Error(`${dataset} has no task ${id}.`);

        return found;
      });

const model = parseModel(args.values.model);

const attempts = Number(args.values.attempts);

const timeoutMs = Number(args.values.timeout) * 1000;

await mkdir(out, { recursive: true });

// Real, so the path the host attaches is the path mounted in the container (/tmp is /private/tmp).
const folder = await realpath(out);

const openModels = await openCatalog([model], folder);

for (const task of tasks) {
  process.stdout.write(`Preparing ${task.id}\n`);
  await docker([
    "build",
    "--quiet",
    "--platform",
    "linux/amd64",
    "-t",
    verifierImage(task),
    join(task.folder, "tests"),
  ]);
  await extractApp(task.image, templateFolder(folder, task));
}

const results = join(folder, "results.jsonl");

await writeFile(results, "");

const jobs = tasks.flatMap((task) =>
  Array.from({ length: attempts }, (_, index) => ({ task, attempt: index + 1 })),
);

const rows = await pool(jobs, Number(args.values.concurrency), async (job) => {
  const row = await runAttempt(job, model, thinking, openModels, timeoutMs, folder);

  await appendFile(results, `${JSON.stringify(row)}\n`);
  process.stdout.write(
    `${job.task.id}#${job.attempt}: ${row.reward === 1 ? "resolved" : "failed"} in ${Math.round(row.agentMs / 1000)}s, $${row.costUsd.toFixed(2)}${row.error === null ? "" : ` (${row.error.split("\n")[0]})`}\n`,
  );

  return row;
});

const summary = {
  schemaVersion: 1,
  dataset: {
    name: "deepswe",
    version: "v1.1",
    commit: await git(dataset, "rev-parse", "HEAD"),
    selection: named === undefined ? SELECTION_SEED : "named",
  },
  model: { id: `${model.provider}/${model.id}`, thinking },
  attempts,
  tasks: tasks.map((task) => task.id),
  timeoutSec: timeoutMs / 1000,
  generatedAt: new Date().toISOString(),
  harness: score(rows, await git(".", "rev-parse", "--short", "HEAD")),
  perTask: tasks.map((task) => ({
    task: task.id,
    language: task.language,
    resolved: rows.filter((row) => row.task === task.id && row.reward === 1).length,
    attempts: rows.filter((row) => row.task === task.id).length,
  })),
};

await writeFile(join(folder, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

process.stdout.write(`\n${JSON.stringify(summary.harness, null, 2)}\n`);

process.exit(0);

/**
 * Runs one attempt the way DeepSWE v1.1 does: the agent works in the task image with no network,
 * the task's collect command turns its commits into `model.patch`, and the task's verifier grades
 * that patch in a fresh container. A crash or a timeout still goes to the verifier, which grades
 * whatever the agent committed.
 */
async function runAttempt(
  job: Job,
  ref: ModelRef,
  level: Thinking,
  factory: ModelsFactory,
  limitMs: number,
  folder: string,
): Promise<Attempt> {
  const dir = join(folder, "attempts", `${job.task.id}-${job.attempt}`);
  const artifacts = join(dir, "artifacts");
  const verifier = join(dir, "verifier");
  await mkdir(artifacts, { recursive: true });
  await mkdir(verifier, { recursive: true });
  const name = `nyte-deepswe-${job.task.id}-${job.attempt}-${process.pid}`;
  const meter = meterUsage();

  const agent = await runAgent(job.task, name, ref, level, await factory(meter.wrap), limitMs, {
    dir,
    template: templateFolder(folder, job.task),
  }).catch((cause: unknown) => ({
    timedOut: false,
    error: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
    agentMs: 0,
    toolCalls: {},
    failedCalls: 0,
  }));

  const patch = await readFile(join(artifacts, "model.patch")).catch(() => Buffer.alloc(0));

  await dockerLogged(
    [
      "run",
      "--rm",
      "--platform",
      "linux/amd64",
      "--network",
      "none",
      "--cpus",
      "2",
      "--memory",
      "8g",
      "-v",
      `${artifacts}:/logs/artifacts`,
      "-v",
      `${verifier}:/logs/verifier`,
      verifierImage(job.task),
      "bash",
      "/tests/test.sh",
    ],
    join(dir, "test-stdout.txt"),
  );

  const parsed: unknown = JSON.parse(
    await readFile(join(verifier, "reward.json"), "utf8").catch(() => "null"),
  );

  const reward = Value.Check(Reward, parsed) ? parsed : null;
  const usage = await meter.total();

  return {
    task: job.task.id,
    language: job.task.language,
    attempt: job.attempt,
    model: `${ref.provider}/${ref.id}`,
    thinking: level,
    reward: reward?.reward ?? null,
    partial: reward?.partial ?? null,
    applyFailed: reward?.apply_failed === 1,
    timedOut: agent.timedOut,
    error: reward === null ? (agent.error ?? "The verifier wrote no reward.json.") : agent.error,
    agentMs: agent.agentMs,
    requests: usage.requests,
    costUsd: usage.cost,
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    firstRequestTokens: usage.first?.tokens ?? null,
    toolCalls: agent.toolCalls,
    failedCalls: agent.failedCalls,
    patchBytes: patch.length,
  };
}

async function runAgent(
  task: Task,
  name: string,
  ref: ModelRef,
  level: Thinking,
  models: Awaited<ReturnType<ModelsFactory>>,
  limitMs: number,
  paths: { readonly dir: string; readonly template: string },
) {
  const dir = paths.dir;
  const workspace = join(dir, "app");

  try {
    await cloneApp(paths.template, workspace);
    await startContainer(name, task.image, workspace);

    await using simulation = await simulate({
      models,
      workspace,
      plugins: [containerExec(name), ...DISABLED.map((id) => ({ id }))],
    });

    const host = simulation.host;
    const started = performance.now();

    const start = await host.sessions.start({
      content: await readFile(join(task.folder, "instruction.md"), "utf8"),
      configuration: { model: ref, thinking: level },
    });

    const settled = await settle(host, start.session.id, Date.now() + limitMs, () => false);
    const agentMs = Math.round(performance.now() - started);

    await writeFile(
      join(dir, "sessions.json"),
      JSON.stringify(settled.members.map((member) => ({ by: member.by, view: member.view }))),
    );
    await docker(["exec", name, "bash", "-c", task.collect]);
    await docker([
      "cp",
      `${name}:/logs/artifacts/model.patch`,
      join(dir, "artifacts", "model.patch"),
    ]);

    const calls = settled.members.flatMap((member) =>
      member.view.messages.flatMap((message) => (isPart(message, tool) ? [message.state] : [])),
    );

    const execution = settled.members[0]?.view.execution;
    const end = execution?.kind === "idle" ? execution.lastRun?.end : undefined;

    return {
      timedOut: settled.timedOut,
      error: end?.kind === "failed" ? end.failure.message : null,
      agentMs,
      toolCalls: Object.fromEntries(
        [...new Set(calls.map((call) => call.name))].map((callName) => [
          callName,
          calls.filter((call) => call.name === callName).length,
        ]),
      ),
      failedCalls: calls.filter((call) => call.phase === "settled" && call.outcome.kind !== "ok")
        .length,
    };
  } finally {
    await removeContainer(name);
  }
}

/** The run's score in the shape eve publishes for each harness, so a Nyte row sits beside theirs. */
function score(rows: readonly Attempt[], version: string) {
  const resolved = rows.filter((row) => row.reward === 1).length;
  const cost = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const input = rows.reduce((sum, row) => sum + row.inputTokens, 0);
  const latencies = rows.map((row) => row.agentMs).sort((a, b) => a - b);

  return {
    harness: "nyte",
    version,
    resolved,
    attempts: rows.length,
    resolveRate: { estimate: resolved / Math.max(1, rows.length), ...taskBootstrap(rows) },
    costUsd: cost,
    costPerResolvedUsd: resolved === 0 ? null : cost / resolved,
    inputTokens: input,
    outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    cachedShare:
      input === 0 ? null : rows.reduce((sum, row) => sum + row.cacheReadTokens, 0) / input,
    firstRequestTokensP50: quantile(
      rows
        .flatMap((row) => (row.firstRequestTokens === null ? [] : [row.firstRequestTokens]))
        .sort((a, b) => a - b),
      0.5,
    ),
    latencyP50Ms: quantile(latencies, 0.5),
    latencyP90Ms: quantile(latencies, 0.9),
    source: version,
    runUrl: null,
    measuredAt: new Date().toISOString(),
  };
}

/** A 95% interval from resampling whole tasks, as eve-bench does: more tasks narrow it, more attempts barely do. */
function taskBootstrap(rows: readonly Attempt[]) {
  const ids = [...new Set(rows.map((row) => row.task))];

  const byTask = ids.map((id) => {
    const own = rows.filter((row) => row.task === id);

    return { resolved: own.filter((row) => row.reward === 1).length, attempts: own.length };
  });

  const random = mulberry32(1);

  const rates = Array.from({ length: 10_000 }, () => {
    const drawn = byTask.flatMap(() => byTask[Math.floor(random() * byTask.length)] ?? []);

    const attempted = drawn.reduce((sum, entry) => sum + entry.attempts, 0);

    return drawn.reduce((sum, entry) => sum + entry.resolved, 0) / Math.max(1, attempted);
  }).sort((a, b) => a - b);

  return { low: quantile(rates, 0.025), high: quantile(rates, 0.975) };
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const below = sorted[Math.floor(position)] ?? 0;
  const above = sorted[Math.ceil(position)] ?? below;

  return below + (above - below) * (position - Math.floor(position));
}

function mulberry32(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

async function loadTasks(folder: string): Promise<readonly Task[]> {
  const entries = await readdir(folder, { withFileTypes: true });

  const found = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const taskFolder = join(folder, entry.name);
        const toml = await readFile(join(taskFolder, "task.toml"), "utf8").catch(() => null);

        if (toml === null) return [];
        const image = /^docker_image = "([^"]+)"$/m.exec(toml)?.[1];
        const language = /^language = "([^"]+)"$/m.exec(toml)?.[1];
        const collect = /\[\[verifier\.collect\]\]\ncommand = "((?:[^"\\]|\\.)*)"/.exec(toml)?.[1];

        if (image === undefined || language === undefined || collect === undefined)
          throw new Error(
            `${taskFolder}/task.toml has no docker_image, language or collect command.`,
          );

        return [
          {
            id: entry.name,
            folder: taskFolder,
            language,
            image,
            collect: collect.replaceAll('\\"', '"'),
          },
        ];
      }),
  );

  return found.flat();
}

function seedHash(id: string): string {
  return createHash("sha256").update(`${SELECTION_SEED}:${id}`).digest("hex");
}

function templateFolder(folder: string, task: Task): string {
  return join(folder, "templates", task.id);
}

function verifierImage(task: Task): string {
  return `nyte-deepswe-verify:${task.id}`;
}

async function git(cwd: string, ...gitArgs: readonly string[]): Promise<string> {
  const result = await promisify(execFile)("git", gitArgs, { cwd });

  return result.stdout.trim();
}

/** Runs docker with its output in `logFile`, waiting for it to exit whatever its status. */
async function dockerLogged(dockerArgs: readonly string[], logFile: string): Promise<void> {
  const log = await open(logFile, "w");
  const child = spawn("docker", dockerArgs, { stdio: ["ignore", log.fd, log.fd] });

  await once(child, "exit");
  await log.close();
}
