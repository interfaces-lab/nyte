import { execFileSync } from "node:child_process";
import { existsSync, globSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const USAGE = `Usage: node scripts/release-version.mjs resolve (--bump <major|minor|patch> | --version <version> | --nightly)
       node scripts/release-version.mjs prepare <version> [--check]
       node scripts/release-version.mjs changelog <version>

resolve    Print version=<version> for $GITHUB_OUTPUT. --bump adds to the highest stable v<x.y.z>
           tag, --version is used as given, and --nightly previews the next patch.
prepare    Write <version> into every released package.json. --check only validates.
changelog  Prepend "## v<version> — <date>" with $RELEASE_NOTES to CHANGELOG.md, once.`;

const STABLE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;

function fail(message) {
  process.stderr.write(`${message}\n\n${USAGE}\n`);
  process.exit(1);
}

/** The highest stable release tag, compared numerically, so v0.0.10 sorts above v0.0.9. */
function latestStable() {
  const versions = execFileSync("git", ["tag", "--list", "v*"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .map((tag) => tag.trim().slice(1))
    .filter((version) => STABLE.test(version))
    .map((version) => version.split(".").map(Number))
    .sort((left, right) => right[0] - left[0] || right[1] - left[1] || right[2] - left[2]);

  if (versions.length === 0) throw new Error("No stable v<x.y.z> tag was found. Fetch tags first.");

  return versions[0];
}

function bump(kind) {
  const [major, minor, patch] = latestStable();

  if (kind === "major") return `${major + 1}.0.0`;

  if (kind === "minor") return `${major}.${minor + 1}.0`;

  if (kind === "patch") return `${major}.${minor}.${patch + 1}`;

  throw new Error(`Unknown bump: ${kind}. Use major, minor or patch.`);
}

function nightly() {
  const run = process.env["GITHUB_RUN_NUMBER"];

  if (run === undefined || !/^[1-9]\d*$/u.test(run))
    throw new Error("Set GITHUB_RUN_NUMBER to the nightly workflow run number.");
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");

  return `${bump("patch")}-nightly.${date}.${run}`;
}

function released() {
  const { release } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  const manifests = globSync(["packages/*/package.json", "packages/examples/*/package.json"], {
    cwd: root,
  }).map((file) => ({
    file: join(root, file),
    manifest: JSON.parse(readFileSync(join(root, file), "utf8")),
  }));

  return release.packages.map((name) => {
    const entry = manifests.find(({ manifest }) => manifest.name === name);

    if (entry === undefined) throw new Error(`Missing release package: ${name}`);

    return entry;
  });
}

function prepare(version, check) {
  if (!VERSION.test(version)) throw new Error(`Invalid release version: ${version}`);
  const entries = released();

  const sources = new Set(
    entries.map(({ manifest }) => manifest.version).filter((source) => source !== version),
  );

  if (sources.size > 1)
    throw new Error(
      `The release packages must share one version; found ${[...sources].join(", ")}.`,
    );

  if (check) return;

  for (const { file, manifest } of entries) {
    if (manifest.version !== version)
      writeFileSync(file, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  }
}

function changelog(version) {
  const notes = process.env["RELEASE_NOTES"]?.trim() ?? "";

  if (notes === "") return;
  const file = join(root, "CHANGELOG.md");
  const lines = (existsSync(file) ? readFileSync(file, "utf8") : "# Changelog\n").split("\n");
  const heading = `## v${version}`;

  if (lines.some((line) => line === heading || line.startsWith(`${heading} `))) return;
  const first = lines.findIndex((line) => line.startsWith("## "));
  const head = (first === -1 ? lines : lines.slice(0, first)).join("\n").trimEnd();
  const rest = first === -1 ? "" : `\n${lines.slice(first).join("\n")}`;
  const date = new Date().toISOString().slice(0, 10);

  writeFileSync(file, `${head}\n\n${heading} — ${date}\n\n${notes}\n${rest}`);
}

const [command, ...rest] = process.argv.slice(2);

if (command === "resolve") {
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      bump: { type: "string" },
      version: { type: "string" },
      nightly: { type: "boolean" },
    },
    allowPositionals: true,
  });

  const chosen = [values.bump, values.version, values.nightly].filter((value) => value);

  if (positionals.length > 0 || chosen.length !== 1)
    fail("resolve takes exactly one of --bump, --version or --nightly.");

  const version =
    values.version ?? (values.nightly === true ? nightly() : bump(values.bump ?? "patch"));

  if (!VERSION.test(version)) throw new Error(`Invalid release version: ${version}`);
  process.stdout.write(`version=${version}\n`);
} else if (command === "prepare" && rest[0] !== undefined && rest.length <= 2) {
  if (rest[1] !== undefined && rest[1] !== "--check") fail(`Unknown option: ${rest[1]}`);
  prepare(rest[0], rest[1] === "--check");
} else if (command === "changelog" && rest.length === 1 && rest[0] !== undefined) {
  if (!VERSION.test(rest[0])) throw new Error(`Invalid release version: ${rest[0]}`);
  changelog(rest[0]);
} else if (command === "--help" || command === "-h") {
  process.stdout.write(`${USAGE}\n`);
} else {
  fail(command === undefined ? "Missing command." : `Unknown command: ${command}`);
}
