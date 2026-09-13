import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
// Build the fixture first: a leftover generated app exposed the production discovery regression.
for (const command of ["build:fixture", "build"]) {
  const result = spawnSync("pnpm", ["--config.verify-deps-before-run=false", "run", command], {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stdout + result.stderr);
    throw new Error(`${command} failed.`);
  }
}

const published: unknown = JSON.parse(
  await readFile(new URL(".vercel/output/diagnostics/workflows-manifest.json", root), "utf8"),
);
assert.ok(typeof published === "object" && published !== null);
assert.ok(
  "workflows" in published &&
    typeof published.workflows === "object" &&
    published.workflows !== null,
);
assert.ok("steps" in published && typeof published.steps === "object" && published.steps !== null);
const workflows = Object.keys(published.workflows);
const steps = Object.keys(published.steps);
assert.ok(workflows.length > 0, "Production must register its durable workflow.");
assert.ok(
  [...workflows, ...steps].every((path) => !path.split(/[\\/]/).includes(".fixtures")),
  "Production must not publish generated fixture workflows or steps.",
);
console.log(
  "Passed: preview fixture and production build independently; fixture execution is not published in production.",
);
