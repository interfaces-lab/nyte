/**
 * Plugin sources on a real directory: a plugin that lives in a directory
 * changes version when any file under it does, and the watcher holds its
 * gate from the first raw event until the change handler has run.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "vitest";
import {
  createPluginSources,
  discoverPluginUnits,
  nodePluginLoader,
  resolvePlugins,
  watchPluginDirectories,
} from "../src/plugins.ts";
const sources = createPluginSources(nodePluginLoader({}), async () => {});

const directories: string[] = [];
afterEach(() => {
  sources.dispose();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function pluginsDirectory(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "nyte-plugins-")));
  directories.push(directory);
  return directory;
}

const plugin = (id: string) =>
  `import { greeting } from "./lib.ts";\nexport default { id: ${JSON.stringify(id)}, greeting, session() {} };\n`;

test("editing a helper reloads native Node ESM even with unchanged mtime and size", async () => {
  const directory = pluginsDirectory();
  mkdirSync(join(directory, "greet"));
  const entry = join(directory, "greet", "index.ts");
  const helper = join(directory, "greet", "lib.ts");
  writeFileSync(entry, `await Promise.resolve();\n${plugin("greet")}`);
  writeFileSync(helper, 'export const greeting = "hi";\n');
  await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import assert from "node:assert/strict";
    import { statSync, utimesSync, writeFileSync } from "node:fs";
    import { createPluginSources } from ${JSON.stringify(new URL("../src/plugins/sources.ts", import.meta.url).href)};
    import { nodePluginLoader } from ${JSON.stringify(new URL("../src/plugins/node-loader.ts", import.meta.url).href)};
    const sources = createPluginSources(nodePluginLoader({}), async () => {});
    const entry = ${JSON.stringify(entry)};
    const helper = ${JSON.stringify(helper)};
    const info = statSync(helper);
    try {
      const first = await sources.read(entry);
      assert.equal(first.value.default.greeting, "hi");
      assert.equal((await sources.read(entry)).version, first.version);
      writeFileSync(helper, 'export const greeting = "yo";\\n');
      utimesSync(helper, info.atime, info.mtime);
      const next = await sources.read(entry);
      assert.notEqual(next.version, first.version);
      assert.equal(next.value.default.greeting, "yo");
    } finally { sources.dispose(); }
  `,
  ]);
});

test("canonical roots replace whole units and ignore loose and legacy entries", async () => {
  const directory = pluginsDirectory();
  const user = join(directory, "user");
  const project = join(directory, "project");
  mkdirSync(join(user, "greet"), { recursive: true });
  mkdirSync(join(project, "greet"), { recursive: true });
  mkdirSync(join(user, "tui"), { recursive: true });
  writeFileSync(join(user, "greet", "index.ts"), 'export default { id: "greet", session() {} };');
  writeFileSync(join(project, "greet", "tui.js"), 'export default { id: "greet", setup() {} };');
  writeFileSync(join(user, "loose.ts"), 'throw new Error("legacy");');
  writeFileSync(join(user, "tui", "legacy.ts"), 'throw new Error("legacy");');
  const directories = [
    { path: user, source: "user" },
    { path: project, source: "project" },
  ] as const;
  const units = await discoverPluginUnits(directories);
  assert.equal(units.length, 1);
  assert.equal(units[0]?.path, join(project, "greet"));
  assert.deepEqual(units[0]?.entries, { tui: join(project, "greet", "tui.js") });
  const prepared = await resolvePlugins({ sources, builtins: [], directories });
  assert.deepEqual(prepared.failures, []);
  assert.deepEqual(prepared.plugins, []);
});

test("failed evaluations are cached until bytes change and keep their place as failed placeholders", async () => {
  const directory = pluginsDirectory();
  const unit = join(directory, "broken");
  const marker = join(directory, "attempts");
  const entry = join(unit, "index.ts");
  mkdirSync(unit);
  writeFileSync(
    entry,
    `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(marker)}, "attempt\\n"); throw new Error("broken plugin");`,
  );
  const builtin = { id: "builtin", session: () => undefined };
  const options = {
    sources,
    builtins: [builtin],
    directories: [{ path: directory, source: "project" }],
  } as const;
  for (let attempt = 0; attempt < 2; attempt++) {
    const prepared = await resolvePlugins(options);
    assert.deepEqual(
      prepared.failures.map((failure) => [failure.id, failure.path]),
      [["broken", entry]],
    );
    assert.match(prepared.failures[0]?.error ?? "", /broken plugin/);
    assert.deepEqual(
      prepared.plugins.map((plugin) => plugin.id),
      ["builtin", "broken"],
    );
  }
  assert.equal(readFileSync(marker, "utf8"), "attempt\n");
  sources.invalidate();
  assert.equal((await resolvePlugins(options)).failures.length, 1);
  assert.equal(readFileSync(marker, "utf8"), "attempt\nattempt\n");
  writeFileSync(entry, 'export default { id: "broken", session() {} };');
  assert.deepEqual((await resolvePlugins(options)).failures, []);
  writeFileSync(join(directory, "not-a-directory"), "x");
  const unreadable = await resolvePlugins({
    ...options,
    directories: [{ path: join(directory, "not-a-directory"), source: "project" }],
  });
  assert.deepEqual(
    unreadable.plugins.map((plugin) => plugin.id),
    ["builtin"],
  );
  assert.equal(unreadable.failures[0]?.path, join(directory, "not-a-directory"));
  assert.equal(unreadable.failures[0]?.id, undefined);
});

test("unit data reloads and import.meta.url still resolves real assets", async () => {
  const directory = pluginsDirectory();
  const unit = join(directory, "data");
  mkdirSync(unit);
  const entry = join(unit, "index.ts");
  const asset = join(unit, "prompt.md");
  writeFileSync(
    entry,
    'import { readFileSync } from "node:fs"; export const text = readFileSync(new URL("./prompt.md", import.meta.url), "utf8");',
  );
  writeFileSync(asset, "first");
  const first = await sources.read(entry);
  assert.ok(typeof first.value === "object" && first.value !== null && "text" in first.value);
  assert.equal(first.value.text, "first");
  writeFileSync(asset, "other");
  const next = await sources.read(entry);
  assert.notEqual(next.version, first.version);
  assert.ok(typeof next.value === "object" && next.value !== null && "text" in next.value);
  assert.equal(next.value.text, "other");
});

test("a unit with no node_modules ancestor imports host modules under native Node ESM", async () => {
  const directory = pluginsDirectory();
  mkdirSync(join(directory, "typed"));
  const entry = join(directory, "typed", "index.ts");
  writeFileSync(
    entry,
    [
      'import { definePlugin } from "@nyte-ai/plugin";',
      'import { Type } from "typebox";',
      'import { Value } from "typebox/value";',
      'export default definePlugin({ id: "typed", session() {} });',
      'export const ok = Value.Check(Type.String(), "x");',
    ].join("\n"),
  );
  await promisify(execFile)(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import assert from "node:assert/strict";
    import { createPluginSources } from ${JSON.stringify(new URL("../src/plugins/sources.ts", import.meta.url).href)};
    import { nodePluginLoader } from ${JSON.stringify(new URL("../src/plugins/node-loader.ts", import.meta.url).href)};
    import { hostModules } from ${JSON.stringify(new URL("../src/plugins/host-modules.ts", import.meta.url).href)};
    const sources = createPluginSources(nodePluginLoader(hostModules), async () => {});
    try {
      const loaded = await sources.read(${JSON.stringify(entry)});
      assert.equal(loaded.value.default.id, "typed");
      assert.equal(loaded.value.ok, true);
    } finally { sources.dispose(); }
  `,
  ]);
});

test("the watcher holds from the first raw event until the change handler has run", async () => {
  const directory = pluginsDirectory();
  const log: string[] = [];
  let changed: (() => void) | undefined;
  const stop = watchPluginDirectories({
    directories: [{ path: directory, recursive: false }],
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
    await waitFor(() => {
      if (log.length === 0) writeFileSync(join(directory, "a.ts"), "export default {};\n");
      return log.includes("change");
    });
    assert.deepEqual(log, ["hold", "change"]);
    changed?.();
    await waitFor(() => log.includes("release"));
    assert.deepEqual(log, ["hold", "change", "release"]);
  } finally {
    stop();
  }
});

test("duplicate watch paths merge names and unrestricted targets dominate", async () => {
  const directory = pluginsDirectory();
  let changes = 0;
  const stop = watchPluginDirectories({
    directories: [
      { path: directory, recursive: false, names: ["AGENTS.md"] },
      { path: join(directory, "."), recursive: false, names: ["settings.json"] },
    ],
    debounceMs: 10,
    onChange: () => {
      changes += 1;
    },
  });
  try {
    writeFileSync(join(directory, "settings.json"), "{}");
    await waitFor(() => changes > 0);
    const before = changes;
    writeFileSync(join(directory, "AGENTS.md"), "context");
    await waitFor(() => changes > before);
  } finally {
    stop();
  }
  let unrestricted = false;
  const stopAll = watchPluginDirectories({
    directories: [
      { path: directory, recursive: false, names: ["settings.json"] },
      { path: directory, recursive: false },
    ],
    debounceMs: 10,
    onChange: () => {
      unrestricted = true;
    },
  });
  try {
    writeFileSync(join(directory, "unlisted"), "data");
    await waitFor(() => unrestricted);
  } finally {
    stopAll();
  }
});

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
