import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "vitest";

const run = promisify(execFile);
const launcher = fileURLToPath(new URL("./qa/launch.mjs", import.meta.url));

test("all TUI invokables work with short and long transcripts through real OpenTUI", async () => {
  const result = await run("node", [launcher], { timeout: 150_000, maxBuffer: 4 * 1024 * 1024 });
  assert.match(result.stdout, /\d+\/\d+ passed; 0 failed\./);
}, 160_000);

test("visible playback rejects a pipe instead of pretending a terminal was tested", async () => {
  await assert.rejects(
    run("node", [launcher, "--show", "--filter", "/help"]),
    /Visible playback needs a terminal/,
  );
});
