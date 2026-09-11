/**
 * Plugin sources on a real directory: a plugin that lives in a directory
 * changes version when any file under it does, and the watcher holds its
 * gate from the first raw event until the change handler has run.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import { resolvePlugins, watchPluginDirectories } from "../src/plugins/sources.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function pluginsDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "nyte-plugins-"));
  directories.push(directory);
  return directory;
}

const plugin = (id: string) =>
  `import { greeting } from "./lib.ts";\nexport default { id: ${JSON.stringify(id)}, greeting, session() {} };\n`;

async function versionOf(directory: string, id: string): Promise<string> {
  const resolved = await resolvePlugins({
    builtins: [],
    directories: [{ path: directory, source: "project" }],
  });
  assert.deepEqual(resolved.failures, []);
  const found = resolved.plugins.find((item) => item.id === id);
  assert.ok(found);
  return found.version;
}

test("editing a helper under a directory plugin gives it a new version", async () => {
  const directory = pluginsDirectory();
  mkdirSync(join(directory, "greet"));
  writeFileSync(join(directory, "greet", "index.ts"), plugin("greet"));
  writeFileSync(join(directory, "greet", "lib.ts"), 'export const greeting = "hi";\n');
  const first = await versionOf(directory, "greet");
  assert.equal(await versionOf(directory, "greet"), first);
  // A later mtime and a different size, so the version changes on any platform's clock.
  writeFileSync(join(directory, "greet", "lib.ts"), 'export const greeting = "hello";\n');
  assert.notEqual(await versionOf(directory, "greet"), first);
});

test("the watcher holds from the first raw event until the change handler has run", async () => {
  const directory = pluginsDirectory();
  const log: string[] = [];
  let changed: (() => void) | undefined;
  const stop = watchPluginDirectories({
    directories: [{ path: directory }],
    debounceMs: 20,
    hold: () => {
      log.push("hold");
      return () => log.push("release");
    },
    onChange: () =>
      new Promise<void>((resolve) => {
        log.push("change");
        changed = resolve;
      }),
  });
  try {
    writeFileSync(join(directory, "a.ts"), "export default {};\n");
    await waitFor(() => log.includes("change"));
    assert.deepEqual(log, ["hold", "change"]);
    changed?.();
    await waitFor(() => log.includes("release"));
    assert.deepEqual(log, ["hold", "change", "release"]);
  } finally {
    stop();
  }
});

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
