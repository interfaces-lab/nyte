import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const label = process.argv[2] ?? "run";

const RENDER_REPEATS = Number(process.env["BENCH_RENDER_REPEATS"] ?? 5);

const results = process.env["BENCH_RESULTS"] ?? "/tmp/nyte-tui-metrics";

type Row = Record<string, unknown>;

function run(args: readonly string[]): Row {
  const started = performance.now();
  const result = spawnSync("bun", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 });

  if (result.status !== 0) throw new Error(`bun ${args.join(" ")} failed:\n${result.stderr}`);
  const line = result.stdout.trim().split("\n").at(-1) ?? "";

  if (!line.startsWith("{")) return { _ms: performance.now() - started };
  const parsed: unknown = JSON.parse(line);

  if (typeof parsed !== "object" || parsed === null) throw new Error(`Not a row: ${line}`);

  return { ...parsed, _ms: performance.now() - started };
}

function medianRows(rows: readonly Row[]): Row {
  const first = rows[0] ?? {};

  return Object.fromEntries(
    Object.keys(first).map((key) => {
      const values = rows.map((row) => row[key]);

      if (!values.every((value) => typeof value === "number")) return [key, first[key]];
      const sorted = values.toSorted((a, b) => a - b);

      return [key, sorted[Math.floor(sorted.length / 2)]];
    }),
  );
}

const build = run(["scripts/build-binary.ts"]);

const binaryMb = Math.round((statSync(join(root, "dist/nyte")).size / 1024 / 1024) * 10) / 10;

const bundle = run(["bench/bundle.ts"]);

const render = medianRows(
  Array.from({ length: RENDER_REPEATS }, () =>
    run(["--preload", "@opentui/solid/preload", "bench/render.tsx"]),
  ),
);

const boot = run(["bench/boot.ts"]);

const strip = (row: Row): Row =>
  Object.fromEntries(Object.entries(row).filter(([key]) => key !== "_ms"));

const metrics = {
  label,
  at: new Date().toISOString(),
  binary_mb: binaryMb,
  build_s: Math.round(Number(build["_ms"]) / 100) / 10,
  ...strip(bundle),
  ...strip(render),
  ...strip(boot),
};

mkdirSync(results, { recursive: true });

appendFileSync(join(results, "history.jsonl"), `${JSON.stringify(metrics)}\n`);

process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
