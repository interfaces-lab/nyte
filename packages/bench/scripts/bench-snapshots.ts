import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { memoryStore } from "@nyte-ai/core/store";
import type { Session } from "@nyte-ai/core";
import { openHost } from "@nyte-ai/host";
import { PERMISSIONS } from "@nyte-ai/plugin/approvals/schema";
import { fakeModels, lastUserText, titleReply } from "../src/index.ts";
import type { Reply, Request } from "../src/index.ts";

const SELF = fileURLToPath(import.meta.url);

const parsed = parseArgs({
  options: {
    files: { type: "string", default: "100000" },
    runs: { type: "string", default: "8" },
    warmup: { type: "string", default: "2" },
    gate: { type: "boolean", default: false },
  },
});

const TOOLS = ["write", "bash"] as const;

const RATIO_LIMIT = 3;

const STORE_LIMIT = 64 * 1024;

type Tool = (typeof TOOLS)[number];

type Sample = { readonly cpuMs: number; readonly wallMs: number; readonly storeBytes: number };

type Row = {
  readonly fixture: string;
  readonly tool: Tool;
  readonly runs: number;
  readonly cpuMs: number;
  readonly cpuP90: number;
  readonly wallMs: number;
  readonly storeBytes: number;
};

async function isolate(): Promise<void> {
  const home = await realpath(await mkdtemp(join(tmpdir(), "nyte-bench-snapshots-")));

  const child = spawn(process.execPath, [...process.execArgv, SELF, ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, HOME: home, NYTE_HOME: join(home, ".nyte"), NYTE_BENCH_HOME: home },
  });

  const code = await new Promise<number>((resolve) =>
    child.once("exit", (exit) => resolve(exit ?? 1)),
  );

  await rm(home, { recursive: true, force: true, maxRetries: 10 });
  process.exit(code);
}

async function bench(home: string): Promise<void> {
  const runs = Number(parsed.values.runs);
  const warmup = Number(parsed.values.warmup);
  const files = Number(parsed.values.files);
  const small = await smallFolder(join(home, "small"));
  const large = await largeFolder(join(home, "large"), files);
  const rows: Row[] = [];
  const failures: string[] = [];

  for (const [fixture, root, discovers] of [
    ["small", small, true],
    ["large", large, false],
  ] as const) {
    const measured = await measureFolder(home, root, { runs, warmup }, discovers);
    rows.push(...measured.rows.map((row) => ({ ...row, fixture })));
    failures.push(...measured.missing.map((path) => `${fixture}: ${path} was not recorded`));
  }

  process.stdout.write(
    `\n${String(files)} files in the large folder, ${String(runs)} runs after ${String(warmup)} warmup, node ${process.version}\n\n`,
  );
  process.stdout.write(`${formatTable(rows)}\n`);

  if (!parsed.values.gate) return;

  for (const tool of TOOLS) {
    const base = rows.find((row) => row.fixture === "small" && row.tool === tool);
    const big = rows.find((row) => row.fixture === "large" && row.tool === tool);

    if (base === undefined || big === undefined) continue;

    if (big.cpuMs > base.cpuMs * RATIO_LIMIT)
      failures.push(
        `${tool}: ${big.cpuMs.toFixed(1)} ms of CPU per call in the large folder is over ${String(RATIO_LIMIT)}× the small folder's ${base.cpuMs.toFixed(1)} ms`,
      );

    if (big.storeBytes > STORE_LIMIT)
      failures.push(
        `${tool}: ${String(big.storeBytes)} snapshot bytes per call in the large folder is over ${String(STORE_LIMIT)}`,
      );
  }

  if (failures.length === 0) {
    process.stdout.write("\nGate passed.\n");

    return;
  }

  process.stderr.write(`\nGate failed:\n${failures.map((line) => `- ${line}`).join("\n")}\n`);
  process.exitCode = 1;
}

async function measureFolder(
  home: string,
  root: string,
  counts: { readonly runs: number; readonly warmup: number },
  discovers: boolean,
): Promise<{
  readonly rows: readonly Omit<Row, "fixture">[];
  readonly missing: readonly string[];
}> {
  let calls = 0;

  const fake = fakeModels({
    fallback: (request: Request): Reply => {
      const title = titleReply(request);

      if (title !== null) return { content: [{ type: "text", text: title }] };

      if (request.context.messages.at(-1)?.role === "toolResult")
        return { content: [{ type: "text", text: "Done." }] };
      const [tool, index] = lastUserText(request).split(" ");
      calls += 1;
      const id = `toolu_bench${String(calls).padStart(6, "0")}`;

      if (tool === "write")
        return {
          content: [
            {
              type: "toolCall",
              id,
              name: "write",
              arguments: {
                path: `notes/note-${index ?? ""}.txt`,
                content: `note ${index ?? ""}\n`,
              },
            },
          ],
        };

      if (tool === "bash")
        return {
          content: [
            {
              type: "toolCall",
              id,
              name: "bash",
              arguments: {
                command: `printf 'out\\n' > out-${index ?? ""}.txt`,
                description: "Write an output file",
              },
            },
          ],
        };

      return { content: [{ type: "text", text: "Ok." }] };
    },
  });

  const host = await openHost({
    store: memoryStore(),
    models: fake.models,
    workspace: { kind: "local", path: root },
    home,
  });

  await host.settings.apply(PERMISSIONS, "full");
  const store = join(home, ".nyte", "snapshots");
  const { session, receipt } = await host.sessions.start({ content: "Hi." });
  await receipt.settled();
  const rows: Omit<Row, "fixture">[] = [];
  const expected: string[] = [];

  for (const tool of TOOLS) {
    const samples: Sample[] = [];

    for (let index = 0; index < counts.warmup + counts.runs; index += 1) {
      const name = `${tool}-${String(index)}`;
      const sample = await callOnce(session, store, `${tool} ${name}`);

      if (index >= counts.warmup) samples.push(sample);
      expected.push(tool === "write" ? `notes/note-${name}.txt` : `out-${name}.txt`);
    }

    rows.push(summarize(tool, samples));
  }

  const changed = new Set((await session.view()).changes.map((change) => change.path));

  const missing = expected.filter(
    (path) => !changed.has(path) && (discovers || !path.startsWith("out-")),
  );

  await host.close();

  return { rows, missing };
}

async function callOnce(session: Session, store: string, text: string): Promise<Sample> {
  const bytes = await folderBytes(store);
  const cpu = process.cpuUsage();
  const started = performance.now();
  await (await session.send(text)).settled();
  const wallMs = performance.now() - started;
  const used = process.cpuUsage(cpu);

  return {
    cpuMs: (used.user + used.system) / 1000,
    wallMs,
    storeBytes: (await folderBytes(store)) - bytes,
  };
}

async function smallFolder(root: string): Promise<string> {
  for (let folder = 0; folder < 4; folder += 1) {
    await mkdir(join(root, `src-${String(folder)}`), { recursive: true });
    await Promise.all(
      Array.from({ length: 50 }, (_, file) =>
        writeFile(join(root, `src-${String(folder)}`, `file-${String(file)}.ts`), source(file)),
      ),
    );
  }

  return root;
}

async function largeFolder(root: string, files: number): Promise<string> {
  const repos = 3;
  const perFolder = 500;

  for (let repo = 0; repo < repos; repo += 1) {
    const path = join(root, `repo-${String(repo)}`);
    await mkdir(path, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: path });
    await writeFile(join(path, ".gitignore"), "node_modules/\n");
  }

  for (let folder = 0; folder * perFolder < files; folder += 1) {
    const area =
      folder % 4 === 0
        ? join(`repo-${String(folder % repos)}`, "node_modules", `pkg-${String(folder)}`)
        : join(`plain-${String(folder % 7)}`, `deep-${String(folder)}`, "nested");

    const path = join(root, area);
    await mkdir(path, { recursive: true });

    await Promise.all(
      Array.from({ length: Math.min(perFolder, files - folder * perFolder) }, (_, file) =>
        writeFile(join(path, `file-${String(file)}.ts`), source(file)),
      ),
    );
  }

  return root;
}

function source(seed: number): string {
  return `export const value${String(seed)} = ${String(seed)};\n`;
}

async function folderBytes(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true, recursive: true }).catch(() => []);

  const sizes = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => stat(join(entry.parentPath, entry.name)).then((found) => found.size)),
  );

  return sizes.reduce((sum, size) => sum + size, 0);
}

function summarize(tool: Tool, samples: readonly Sample[]): Omit<Row, "fixture"> {
  const cpu = samples.map((sample) => sample.cpuMs).toSorted((a, b) => a - b);
  const wall = samples.map((sample) => sample.wallMs).toSorted((a, b) => a - b);
  const store = samples.map((sample) => sample.storeBytes).toSorted((a, b) => a - b);

  return {
    tool,
    runs: samples.length,
    cpuMs: quantile(cpu, 0.5),
    cpuP90: quantile(cpu, 0.9),
    wallMs: quantile(wall, 0.5),
    storeBytes: quantile(store, 0.5),
  };
}

function quantile(sorted: readonly number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
}

function formatTable(rows: readonly Row[]): string {
  const header = ["folder", "tool", "runs", "cpu ms", "cpu p90", "wall ms", "snapshot bytes"];

  const lines = rows.map((row) => [
    row.fixture,
    row.tool,
    String(row.runs),
    row.cpuMs.toFixed(1),
    row.cpuP90.toFixed(1),
    row.wallMs.toFixed(1),
    String(row.storeBytes),
  ]);

  const widths = header.map((cell, index) =>
    Math.max(cell.length, ...lines.map((line) => line[index]?.length ?? 0)),
  );

  return [header, ...lines]
    .map((line) => line.map((cell, index) => cell.padStart(widths[index] ?? 0)).join("  "))
    .join("\n");
}

const benchHome = process.env.NYTE_BENCH_HOME;

if (benchHome === undefined) await isolate();
else await bench(benchHome);
