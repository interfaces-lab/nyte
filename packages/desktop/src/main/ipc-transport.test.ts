import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { build } from "vite";
import { test } from "vitest";
import { electronExecutable, isolatedElectronEnvironment } from "./fixtures/electron.ts";

const execute = promisify(execFile);

test("production preload preserves rejected error data through Electron", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-ipc-transport-"));

  try {
    await Promise.all(["profile", "session", "home"].map((name) => mkdir(join(directory, name))));

    for (const entry of [
      { source: "./fixtures/ipc-transport-main.ts", output: "main.cjs", format: "cjs" },
      { source: "../preload/index.ts", output: "preload.cjs", format: "cjs" },
      { source: "./fixtures/ipc-transport-renderer.ts", output: "renderer.js", format: "iife" },
    ] as const) {
      await build({
        configFile: false,
        envDir: false,
        logLevel: "silent",
        build: {
          target: "esnext",
          outDir: directory,
          emptyOutDir: false,
          lib: {
            entry: fileURLToPath(new URL(entry.source, import.meta.url)),
            name: "TransportTest",
            formats: [entry.format],
            fileName: () => entry.output,
          },
          rollupOptions: {
            external: (id) => id === "electron" || id.startsWith("node:"),
            treeshake: { moduleSideEffects: false },
          },
        },
      });
    }

    await writeFile(
      join(directory, "index.html"),
      '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'"><script src="renderer.js"></script>',
    );

    const env = {
      ...isolatedElectronEnvironment(directory),
      NYTE_HOME: join(directory, "home", "nyte"),
    };

    await execute(
      electronExecutable,
      [join(directory, "main.cjs"), directory, "--use-mock-keychain", "--password-store=basic"],
      { cwd: directory, env, timeout: 30_000 },
    );
    assert.equal(await readFile(join(directory, "result.txt"), "utf8"), "passed");
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10 });
  }
}, 90_000);
