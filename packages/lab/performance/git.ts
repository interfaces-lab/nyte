import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { parsePatchFiles } from "@pierre/diffs";
import type { VcsDiff } from "@nyte-ai/protocol";
import { createGitVcs } from "../../host/src/git.ts";
import { gitOutput, readGitManifest } from "./git-manifest.ts";

function integer(value: string | undefined, fallback: number, name: string): number {
  const number = value === undefined ? fallback : Number(value);

  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`);
  }

  return number;
}

async function measure<T>(operation: () => Promise<T>) {
  const start = performance.now();
  const value = await operation();

  return { value, ms: performance.now() - start };
}

function patchBytes(files: readonly VcsDiff[]): number {
  return files.reduce((bytes, file) => bytes + Buffer.byteLength(file.patch), 0);
}

function parseInstalled(files: readonly VcsDiff[]) {
  const start = performance.now();

  const parsed = files.flatMap((file) =>
    parsePatchFiles(file.patch, undefined, true).flatMap((patch) => patch.files),
  );

  const ms = performance.now() - start;

  assert.equal(parsed.length, files.length);
  assert.deepEqual(
    parsed.map((file) => file.name).toSorted(),
    files.map((file) => file.path).toSorted(),
  );

  return {
    ms,
    inputPatches: files.length,
    inputPatchBytes: patchBytes(files),
    parsedFiles: parsed.length,
    parsedSideLines: parsed.reduce(
      (lines, file) => lines + file.additionLines.length + file.deletionLines.length,
      0,
    ),
  };
}

function verifyPatches({
  baseline,
  demanded,
  paths,
  lines,
}: {
  readonly baseline: readonly VcsDiff[];
  readonly demanded: readonly VcsDiff[];
  readonly paths: readonly string[];
  readonly lines: number;
}): void {
  const byPath = new Map(baseline.map((file) => [file.path, file]));
  assert.equal(demanded.length, paths.length);
  assert.deepEqual(demanded.map((file) => file.path).toSorted(), [...paths].toSorted());

  for (const file of baseline) {
    assert.equal(file.status, "modified");
    assert.equal(file.kind, "text");

    if (file.kind !== "text") throw new Error("Expected text patch");
    assert.equal(file.added, lines);
    assert.equal(file.removed, lines);
    assert.ok(file.patch.length > 0);
  }

  for (const file of demanded) {
    const expected = byPath.get(file.path);
    assert.ok(expected, `Missing baseline patch for ${file.path}`);
    assert.ok(Buffer.from(file.patch).equals(Buffer.from(expected.patch)));
    assert.deepEqual(file, expected);
  }
}

async function createFixture(cwd: string, fileCount: number, lines: number) {
  await gitOutput(cwd, ["init", "-q", "--initial-branch=main"]);
  await gitOutput(cwd, ["config", "user.name", "Nyte Git demo"]);
  await gitOutput(cwd, ["config", "user.email", "demo@example.invalid"]);
  await gitOutput(cwd, ["config", "commit.gpgsign", "false"]);
  await gitOutput(cwd, ["config", "core.autocrlf", "false"]);
  await mkdir(join(cwd, "src"));

  const paths = Array.from(
    { length: fileCount },
    (_, index) => `src/file-${String(index).padStart(5, "0")}.ts`,
  );

  const text = (version: string) =>
    Array.from(
      { length: lines },
      (_, index) =>
        `export const value${String(index)} = "${version} fixture line ${String(index)}";\n`,
    ).join("");

  for (const version of ["old", "new"]) {
    const contents = text(version);

    for (const path of paths) await writeFile(join(cwd, path), contents);
    await gitOutput(cwd, ["add", "--", "src"]);
    await gitOutput(cwd, ["commit", "-qm", version]);
  }

  const oid = (await gitOutput(cwd, ["rev-parse", "HEAD"])).trim();
  assert.match(oid, /^[a-f0-9]{40,64}$/);
  assert.equal((await gitOutput(cwd, ["status", "--porcelain"])).trim(), "");
  assert.equal((await gitOutput(cwd, ["rev-list", "--count", "HEAD"])).trim(), "2");

  return { oid, paths };
}

function spread(values: readonly number[]) {
  assert.ok(values.length > 0);
  const sorted = [...values].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  assert.notEqual(median, undefined);

  return { median, min: sorted[0], max: sorted.at(-1) };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    process.stdout.write(
      "pnpm exec node --conditions=nyte-source packages/lab/performance/git.ts [files=180] [lines=40] [selected=1] [trials=1]\n",
    );

    return;
  }

  if (args.length > 4) throw new Error("Expected at most four numeric arguments");
  const fileCount = integer(args[0], 180, "files");
  const lines = integer(args[1], 40, "lines");
  const selectedCount = integer(args[2], 1, "selected");
  const trials = integer(args[3], 1, "trials");

  if (fileCount > 512 || selectedCount > fileCount || fileCount * lines > 200_000 || trials > 10) {
    throw new Error(
      "Fixture limits: files <= 512, selected <= files, files * lines <= 200000, trials <= 10",
    );
  }

  const cwd = await mkdtemp(join(tmpdir(), "nyte-git-demand-"));

  try {
    const fixture = await createFixture(cwd, fileCount, lines);
    const paths = fixture.paths.slice(0, selectedCount);
    assert.equal(paths.length, selectedCount);
    const scope = { kind: "commit", oid: fixture.oid } as const;
    const backend = createGitVcs();
    const fullRead = () => backend.diff({ cwd, scope, ignoreWhitespace: false });
    const samples = [];

    for (let trial = 0; trial < trials; trial += 1) {
      const first = trial % 2 === 0 ? await measure(fullRead) : undefined;
      const discovery = await measure(() => readGitManifest(cwd, fixture.oid));
      const { manifest } = discovery.value;
      assert.ok(manifest.files.length > 0);
      assert.deepEqual(manifest.scope, scope);
      assert.deepEqual(
        manifest.files,
        fixture.paths.map((path) => ({ path, status: "modified" })),
      );
      assert.ok(manifest.files.every((file) => !("patch" in file)));

      const selected = await measure(() =>
        backend.diff({ cwd, scope: manifest.scope, paths, ignoreWhitespace: false }),
      );

      const baseline = first ?? (await measure(fullRead));
      assert.deepEqual(
        baseline.value.map((file) => ({ path: file.path, status: file.status })),
        manifest.files,
      );
      verifyPatches({ baseline: baseline.value, demanded: selected.value, paths, lines });
      const fullParse = parseInstalled(baseline.value);
      const selectedParse = parseInstalled(selected.value);
      assert.equal(fullParse.parsedSideLines, 2 * fileCount * lines);
      assert.equal(selectedParse.parsedSideLines, 2 * selectedCount * lines);
      samples.push({
        trial,
        order: first === undefined ? "manifest-selected-baseline" : "baseline-manifest-selected",
        manifest: {
          ms: discovery.ms,
          files: manifest.files.length,
          discoveryBytes: discovery.value.discoveryBytes,
          jsonBytes: Buffer.byteLength(JSON.stringify(manifest)),
          patchBytes: 0,
        },
        baseline: {
          ms: baseline.ms,
          files: baseline.value.length,
          patchBytes: patchBytes(baseline.value),
          jsonBytes: Buffer.byteLength(JSON.stringify(baseline.value)),
          parse: fullParse,
        },
        selected: {
          ms: selected.ms,
          files: selected.value.map((file) => ({
            path: file.path,
            patchBytes: Buffer.byteLength(file.patch),
          })),
          patchBytes: patchBytes(selected.value),
          jsonBytes: Buffer.byteLength(JSON.stringify(selected.value)),
          parse: selectedParse,
        },
      });
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          fixture: {
            files: fileCount,
            linesPerSide: lines,
            selectedCount,
            trials,
            oid: fixture.oid,
          },
          runtime: { node: process.version, git: (await gitOutput(cwd, ["--version"])).trim() },
          checks:
            "Nonempty exact manifest, full files and facts, selected patch byte equality, parsed files and lines",
          timingsMs: {
            manifestDiscovery: spread(samples.map((sample) => sample.manifest.ms)),
            baselineDiscoveryAndPatches: spread(samples.map((sample) => sample.baseline.ms)),
            selectedBackendDiscoveryAndPatches: spread(samples.map((sample) => sample.selected.ms)),
            fullSynchronousParse: spread(samples.map((sample) => sample.baseline.parse.ms)),
            selectedSynchronousParse: spread(samples.map((sample) => sample.selected.parse.ms)),
          },
          limitations: [
            "Single-parent modified ASCII text fixture only; no rename, binary, merge, root-commit or worktree parity",
            "Selected backend still discovers the full commit; metadata read does not request patches",
            "Cold parser calls without React, CodeView, highlight workers, or Nyte review hashing",
            "No process-count instrumentation, cancellation, interactive byte limits, FPS or production integration",
            "Sequential trials alternate read order; OS caches are not cleared; fixture setup is excluded",
            "Temporary repository is deleted on exit",
          ],
          samples,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

await main();
