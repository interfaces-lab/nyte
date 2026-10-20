/**
 * `pnpm trace <package> [tsconfig]` records where the type checker spends its time.
 *
 * tsrs cannot generate traces, so this runs the Go TypeScript 7 `tsc` that
 * @nyte-ai/app depends on with `--generateTrace`, writes the trace to the system temp
 * directory, and prints the slowest files and checks with their source positions.
 * Open `trace.json` in https://ui.perfetto.dev for the full timeline; `types_N.json`
 * holds every type each checker created.
 *
 * Usage: node scripts/trace.mjs packages/core [tsconfig.node.json]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const [target, project = "."] = process.argv.slice(2);

if (target === undefined) {
  process.stderr.write("Usage: pnpm trace <package directory> [tsconfig]\n");
  process.exit(2);
}

const directory = resolve(root, target);

const output = join(tmpdir(), "nyte-trace", basename(directory));

const tsc = join(
  dirname(
    createRequire(join(root, "packages/app/package.json")).resolve("typescript/package.json"),
  ),
  "bin/tsc",
);

rmSync(output, { recursive: true, force: true });

try {
  execFileSync(process.execPath, [tsc, "--noEmit", "-p", project, "--generateTrace", output], {
    cwd: directory,
    stdio: "inherit",
  });
} catch {
  process.stderr.write("tsc reported errors; the trace still covers the run.\n");
}

/** Every timed span: complete (`X`) events, and begin/end (`B`/`E`) pairs matched per thread. */
function readSpans(file) {
  const spans = [];
  const open = new Map();

  for (const event of JSON.parse(readFileSync(file, "utf8"))) {
    if (event.ph === "X") spans.push(event);

    if (event.ph === "B") open.set(event.tid, [...(open.get(event.tid) ?? []), event]);

    if (event.ph === "E") {
      const begin = open.get(event.tid).pop();
      spans.push({ ...begin, dur: event.ts - begin.ts });
    }
  }

  return spans.filter((span) => span.args?.path !== undefined);
}

const spans = readSpans(join(output, "trace.json"));

const lineStarts = new Map();

const texts = new Map();

/** `path:line:column` of a node, 1-based. The trace's offset includes the node's leading whitespace. */
function locate(path, offset) {
  if (!texts.has(path)) {
    const text = readFileSync(path, "utf8");
    texts.set(path, text);
    lineStarts.set(path, [0, ...[...text.matchAll(/\n/g)].map((match) => match.index + 1)]);
  }

  const whitespace = /\s*/y;
  whitespace.lastIndex = offset;
  whitespace.exec(texts.get(path));
  const position = whitespace.lastIndex;
  const starts = lineStarts.get(path);
  const line = starts.findLastIndex((start) => start <= position);

  return `${relative(root, path)}:${line + 1}:${position - starts[line] + 1}`;
}

const milliseconds = (event) => `${(event.dur / 1000).toFixed(0).padStart(6)} ms`;

/** The ten longest spans that match, skipping any span inside one already listed. */
function findSlowest(matches) {
  const picked = [];

  for (const span of spans.filter(matches).toSorted((left, right) => right.dur - left.dur)) {
    const nested = picked.some(
      (outer) =>
        outer.tid === span.tid && outer.ts <= span.ts && span.ts + span.dur <= outer.ts + outer.dur,
    );

    if (!nested) picked.push(span);

    if (picked.length === 10) break;
  }

  return picked;
}

process.stdout.write("Slowest files\n");

for (const span of findSlowest((span) => span.name === "checkSourceFile")) {
  process.stdout.write(`${milliseconds(span)}  ${relative(root, span.args.path)}\n`);
}

process.stdout.write("\nSlowest checks\n");

for (const span of findSlowest(
  (span) => span.name.startsWith("check") && span.args.pos !== undefined,
)) {
  process.stdout.write(
    `${milliseconds(span)}  ${span.name}  ${locate(span.args.path, span.args.pos)}\n`,
  );
}

process.stdout.write(`\nTrace: ${output}\n`);
