#!/usr/bin/env node
/**
 * Fails when build output contains Central Icons code. A checkout without a
 * Central license must build with Lucide only; see scripts/icons.mjs.
 *
 *   node scripts/check-no-central.mjs [<path>...]
 *
 * Without paths it scans every package's dist, out and .output, and the
 * terminal binary.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** What only Central's packages produce: their scope, their base component, an import of an alias. */
const MARKERS = [
  /@?central-icons-react/u,
  /CentralIconBase/u,
  /["']central-icons(?:-filled)?(?:\/[^"']*)?["']/u,
];

function defaultPaths() {
  const packages = join(root, "packages");

  return readdirSync(packages).flatMap((name) =>
    ["dist", "out", ".output"]
      .map((folder) => join(packages, name, folder))
      .filter((path) => existsSync(path)),
  );
}

function* files(path) {
  const stats = statSync(path);

  if (stats.isFile()) {
    yield path;

    return;
  }

  for (const entry of readdirSync(path)) {
    if (entry === "node_modules") continue;
    yield* files(join(path, entry));
  }
}

const paths = process.argv.length > 2 ? process.argv.slice(2) : defaultPaths();

const hits = [];

let scanned = 0;

for (const path of paths) {
  for (const file of files(path)) {
    scanned += 1;
    // Read as latin1 so binaries scan byte for byte.
    const text = readFileSync(file, "latin1");
    const match = MARKERS.map((marker) => text.match(marker)?.[0]).find(Boolean);

    if (match !== undefined) hits.push(`${relative(root, file)}: ${match}`);
  }
}

if (hits.length > 0) {
  process.stderr.write(
    `Central Icons code in the build output:\n${hits.map((hit) => `  ${hit}`).join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write(
  `No Central Icons code in ${scanned} files under ${paths.map((path) => relative(root, path)).join(", ")}.\n`,
);
