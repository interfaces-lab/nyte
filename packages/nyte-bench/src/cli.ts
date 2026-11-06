import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { LINEUP, openModels, parseModel } from "./models.ts";
import { describeRow, summarize } from "./report.ts";
import { runSample } from "./sample.ts";
import type { Job, Row } from "./sample.ts";
import { SUITES } from "./suites.ts";

const USAGE =
  "Usage: pnpm --dir packages/nyte-bench bench --out <dir> [--suite id]... [--case id]... [--model provider/id]... [--samples n] [--concurrency n] [--timeout s] [--list]\n";

const args = parseArgs({
  options: {
    suite: { type: "string", multiple: true },
    case: { type: "string", multiple: true },
    model: { type: "string", multiple: true },
    samples: { type: "string", default: "3" },
    concurrency: { type: "string", default: "4" },
    timeout: { type: "string", default: "240" },
    out: { type: "string" },
    list: { type: "boolean", default: false },
  },
});

if (args.values.list) {
  for (const suite of SUITES) {
    process.stdout.write(`${suite.id}: ${suite.title}\n`);

    for (const entry of suite.cases)
      process.stdout.write(`  ${entry.id} (${entry.kind}): ${entry.prompt}\n`);
  }

  process.stdout.write(
    `\nModels: ${LINEUP.map((ref) => `${ref.provider}/${ref.id}`).join(", ")}\n`,
  );
  process.exit(0);
}

const out = args.values.out;

if (out === undefined) {
  process.stderr.write(USAGE);
  process.exit(1);
}

const suites = SUITES.filter(
  (suite) => args.values.suite === undefined || args.values.suite.includes(suite.id),
);

const cases = suites.flatMap((suite) =>
  suite.cases
    .filter((entry) => args.values.case === undefined || args.values.case.includes(entry.id))
    .map((entry) => ({ suite: suite.id, case: entry })),
);

const unknown = [
  ...(args.values.suite ?? []).filter((id) => !SUITES.some((suite) => suite.id === id)),
  ...(args.values.case ?? []).filter((id) => !cases.some((entry) => entry.case.id === id)),
];

if (unknown.length > 0) {
  process.stderr.write(`No suite or case ${unknown.join(", ")}. Run with --list to see them.\n`);
  process.exit(1);
}

const refs = args.values.model?.map(parseModel) ?? LINEUP;

const models = await openModels(refs);

const samples = Number(args.values.samples);

const timeoutMs = Number(args.values.timeout) * 1000;

const jobs: readonly Job[] = refs.flatMap((model) =>
  cases.flatMap((entry) =>
    Array.from({ length: samples }, (_, index) => ({ ...entry, model, sample: index + 1 })),
  ),
);

await mkdir(out, { recursive: true });

const results = join(out, "results.jsonl");

await writeFile(results, "");

const rows = await pool(jobs, Number(args.values.concurrency), async (job) => {
  const row = await runSample(job, models, timeoutMs).catch((cause: unknown): Row => ({
    suite: job.suite,
    model: `${job.model.provider}/${job.model.id}`,
    case: job.case.id,
    kind: job.case.kind,
    sample: job.sample,
    pass: null,
    timedOut: false,
    checks: [],
    trace: null,
    cost: 0,
    ms: 0,
    error: cause instanceof Error ? (cause.stack ?? cause.message) : String(cause),
  }));

  await appendFile(results, `${JSON.stringify(row)}\n`);
  process.stdout.write(`${describeRow(row)}\n`);

  return row;
});

const summary = summarize(rows);

await writeFile(join(out, "summary.md"), summary);

process.stdout.write(`\n${summary}`);

process.exit(0);

async function pool<T, R>(
  items: readonly T[],
  size: number,
  work: (item: T) => Promise<R>,
): Promise<readonly R[]> {
  const done: R[] = [];
  const queue = [...items];

  const worker = async (): Promise<void> => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift())
      done.push(await work(item));
  };

  await Promise.all(Array.from({ length: Math.max(1, size) }, worker));

  return done;
}
