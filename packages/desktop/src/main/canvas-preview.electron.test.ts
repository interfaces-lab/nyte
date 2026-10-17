import { execFile } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { builtinModules, createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { build } from "vite";
import { expect, test } from "vitest";

const execute = promisify(execFile);

const shellRoot = fileURLToPath(new URL("../../../canvas/dist/shell/", import.meta.url));

const galaxy = fileURLToPath(
  new URL("../../../canvas/test/fixtures/repo-galaxy/", import.meta.url),
);

const built = await access(join(shellRoot, "libraries", "three.js")).then(
  () => true,
  () => false,
);

const Report = Type.Object({
  png: Type.Number(),
  heights: Type.Object({ chat: Type.Number(), phone: Type.Number() }),
  errors: Type.Array(Type.Object({ message: Type.String() })),
  console: Type.Array(Type.Object({ level: Type.String(), text: Type.String() })),
});

const Results = Type.Object({
  galaxy: Type.Array(Type.Intersect([Report, Type.Object({ theme: Type.String() })])),
  hung: Type.Object({ kind: Type.String(), ms: Type.Number() }),
  after: Type.Intersect([Report, Type.Object({ kind: Type.Literal("rendered") })]),
});

test.skipIf(!built)(
  "previews the multi-file repo-galaxy offscreen in real Electron, from the scheme-served shell, and a canvas that hangs its renderer holds up no later preview",
  { timeout: 150_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "nyte-canvas-preview-"));

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
            entry: fileURLToPath(new URL("./fixtures/canvas-preview-main.ts", import.meta.url)),
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
        JSON.stringify({ name: "nyte-canvas-preview-test", main: "main.cjs" }),
      );
      const require = createRequire(import.meta.url);
      const electronDirectory = dirname(require.resolve("electron/package.json"));
      const executable = join(
        electronDirectory,
        "dist",
        (await readFile(join(electronDirectory, "path.txt"), "utf8")).trim(),
      );
      const { stderr } = await execute(executable, [directory, directory, shellRoot, galaxy], {
        cwd: directory,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
        timeout: 120_000,
      });

      expect(await readFile(join(directory, "result.txt"), "utf8").catch(() => stderr)).toBe(
        "passed",
      );
      const results: unknown = JSON.parse(await readFile(join(directory, "result.json"), "utf8"));

      if (!Value.Check(Results, results)) throw new Error(JSON.stringify(results));

      for (const result of results.galaxy) {
        expect(result.errors, result.theme).toEqual([]);
        expect(result.png, result.theme).toBeGreaterThan(10_000);
        expect(result.heights.chat, result.theme).toBeGreaterThan(600);
      }

      expect(results.hung.kind).toBe("unavailable");
      expect(results.hung.ms).toBeLessThan(10_000);
      expect(results.after.errors).toEqual([]);
      expect(results.after.heights.chat).toBeGreaterThan(0);

      const proof = process.env["NYTE_CANVAS_PROOF"];

      if (proof !== undefined) {
        await mkdir(proof, { recursive: true });

        for (const theme of ["dark", "light"])
          await copyFile(
            join(directory, `preview-${theme}.png`),
            join(proof, `preview-electron-repo-galaxy-${theme}.png`),
          );
        await copyFile(
          join(directory, "result.json"),
          join(proof, "preview-electron-repo-galaxy.json"),
        );
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
