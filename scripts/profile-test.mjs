import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import process from "node:process";

const root = resolve(import.meta.dirname, "..");

const USAGE = `Usage: pnpm profile:test <package> [test files or filters ...]

Runs one package's tests once in a fresh temp HOME and ranks its files and tests
by wall-clock seconds: Vitest packages through its JSON reporter, the TUI's Bun
tests through Bun's JUnit reporter. Prints METRIC slowest_test_file_seconds, then
the TEST_PROFILE_TOP slowest files (default 15) and tests (default 10).

Example: TEST_PROFILE_TOP=20 pnpm profile:test host test/serve`;

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  process.stdout.write(`${USAGE}\n`);
  process.exit(args.length === 0 ? 1 : 0);
}

const [name = "", ...filters] = args;
const directory = join(root, "packages", name);
const manifest = join(directory, "package.json");

if (!existsSync(manifest)) throw new Error(`No package at packages/${name}.`);
const test = JSON.parse(readFileSync(manifest, "utf8")).scripts?.test ?? "";
const top = Number(process.env.TEST_PROFILE_TOP ?? 15);
const scratch = mkdtempSync(join(tmpdir(), "nyte-profile-test-"));
const home = join(scratch, "home");
const report = join(scratch, test.startsWith("bun test") ? "report.xml" : "report.json");

const command = test.startsWith("bun test")
  ? ["bun", ["test", "--reporter=junit", `--reporter-outfile=${report}`, ...filters]]
  : test.startsWith("vitest")
    ? ["pnpm", ["exec", "vitest", "--run", "--reporter=json", `--outputFile=${report}`, ...filters]]
    : null;

if (command === null) throw new Error(`packages/${name} runs neither Vitest nor bun test.`);
spawnSync("mkdir", ["-p", home]);
const started = performance.now();

const result = spawnSync(command[0], command[1], {
  cwd: directory,
  env: { ...process.env, HOME: home, FORCE_COLOR: "0" },
  stdio: ["ignore", "ignore", "inherit"],
});

const wall = (performance.now() - started) / 1000;

if (!existsSync(report)) throw new Error(`The test run wrote no report (exit ${result.status}).`);
const text = readFileSync(report, "utf8");

const readVitest = () => {
  const parsed = JSON.parse(text);

  return {
    files: parsed.testResults.map((file) => ({
      name: relative(directory, file.name),
      seconds: (file.endTime - file.startTime) / 1000,
    })),
    tests: parsed.testResults.flatMap((file) =>
      file.assertionResults.map((assertion) => ({
        name: `${relative(directory, file.name)} > ${assertion.title}`,
        seconds: (assertion.duration ?? 0) / 1000,
      })),
    ),
    failed: parsed.numFailedTests,
  };
};

const attribute = (tag, key) => new RegExp(`\\b${key}="([^"]*)"`, "u").exec(tag)?.[1] ?? "";

const readJunit = () => {
  const suites = [...text.matchAll(/<testsuite\b[^>]*>/gu)].map((match) => match[0]);
  const cases = [...text.matchAll(/<testcase\b[^>]*>/gu)].map((match) => match[0]);

  return {
    files: suites
      .filter(
        (tag) => attribute(tag, "file") !== "" && attribute(tag, "name") === attribute(tag, "file"),
      )
      .map((tag) => ({ name: attribute(tag, "file"), seconds: Number(attribute(tag, "time")) })),
    tests: cases.map((tag) => ({
      name: `${attribute(tag, "file")} > ${attribute(tag, "name")}`,
      seconds: Number(attribute(tag, "time")),
    })),
    failed: [...text.matchAll(/<failure\b/gu)].length,
  };
};

const profile = report.endsWith(".xml") ? readJunit() : readVitest();
const ranked = (rows) => rows.toSorted((left, right) => right.seconds - left.seconds);
const files = ranked(profile.files);
const round = (seconds) => (Math.round(seconds * 100) / 100).toFixed(2);

process.stdout.write(`METRIC test_suite_seconds{package="${name}"}=${round(wall)}\n`);
process.stdout.write(
  `METRIC slowest_test_file_seconds{package="${name}"}=${round(files[0]?.seconds ?? 0)}\n`,
);
process.stdout.write(`METRIC failed_tests{package="${name}"}=${profile.failed}\n\nSlowest files\n`);

for (const file of files.slice(0, top))
  process.stdout.write(`${round(file.seconds).padStart(8)}s  ${file.name}\n`);
process.stdout.write("\nSlowest tests\n");

for (const row of ranked(profile.tests).slice(0, Math.min(top, 10)))
  process.stdout.write(`${round(row.seconds).padStart(8)}s  ${row.name}\n`);

rmSync(scratch, { recursive: true, force: true });
process.exit(result.status ?? 1);
