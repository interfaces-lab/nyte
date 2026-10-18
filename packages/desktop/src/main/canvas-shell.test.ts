import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { build } from "vite";
import { expect, test } from "vitest";
import { electronExecutable } from "./fixtures/electron.ts";

const execute = promisify(execFile);

const shellRoot = fileURLToPath(new URL("../../../canvas/dist/shell/", import.meta.url));

const fixtures = fileURLToPath(new URL("../../../canvas/test/fixtures/", import.meta.url));

const built = await access(join(shellRoot, "index.html")).then(
  () => true,
  () => false,
);

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();

      if (!Value.Check(Type.Object({ port: Type.Number() }), address)) {
        reject(new Error("No port"));

        return;
      }

      probe.close(() => resolve(address.port));
    });
  });
}

test.skipIf(!built).for(["scheme", "web"] as const)(
  "the built shell renders a compiled canvas in real Electron, over the %s",
  { timeout: 120_000 },
  async (transport) => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-canvas-shell-"));

    try {
      await mkdir(join(directory, "profile"));
      await build({
        configFile: false,
        envDir: false,
        logLevel: "silent",
        resolve: { conditions: ["node"], mainFields: ["module", "main"] },
        build: {
          target: "node24",
          outDir: directory,
          emptyOutDir: false,
          minify: false,
          lib: {
            entry: fileURLToPath(new URL("./fixtures/canvas-main.ts", import.meta.url)),
            formats: ["cjs"],
            fileName: () => "main.cjs",
          },
          rollupOptions: {
            external: (id) =>
              id === "electron" || id.startsWith("node:") || builtinModules.includes(id),
            treeshake: { moduleSideEffects: false },
          },
        },
      });
      await writeFile(
        join(directory, "package.json"),
        JSON.stringify({ name: "nyte-canvas-shell-test", main: "main.cjs" }),
      );

      const { stderr } = await execute(
        electronExecutable,
        [
          directory,
          directory,
          shellRoot,
          join(fixtures, "report.tsx"),
          String(await freePort()),
          transport,
        ],
        {
          cwd: directory,
          env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
          timeout: 90_000,
        },
      );

      expect(await readFile(join(directory, "result.txt"), "utf8").catch(() => stderr)).toBe(
        "passed",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
