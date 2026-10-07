/**
 * Compiles the TUI into `bin/nyte`. `Bun.build` rather than the CLI because
 * the Solid JSX transform is a bundler plugin. Worker entries are named from
 * `packages/` so the host can resolve them in the embedded module graph.
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import solidPlugin from "@opentui/solid/bun-plugin";
import { codemodePlugin } from "./codemode-plugin.ts";
import { binaryDefines } from "./defines.ts";

const destination = fileURLToPath(new URL("../../../bin/", import.meta.url));

const packages = fileURLToPath(new URL("../../", import.meta.url));

const name = process.platform === "win32" ? "nyte.exe" : "nyte";

const started = performance.now();

/**
 * `Bun.build` reports a failed bundle by throwing an `AggregateError` whose
 * `errors` hold the diagnostics. Printing only the top-level `message` reduces
 * every failure to "Bundle failed", so recurse into the aggregate.
 */
function describe(cause: unknown): string {
  if (cause instanceof AggregateError) {
    return [cause.message, ...cause.errors.map((error) => describe(error))].join("\n");
  }

  return cause instanceof Error ? cause.message : String(cause);
}

let directory: string | undefined;

try {
  await mkdir(destination, { recursive: true });
  directory = await mkdtemp(join(destination, ".nyte-build-"));
  const executable = join(directory, name);

  const result = await Bun.build({
    entrypoints: [
      join(packages, "tui/src/binary.ts"),
      join(packages, "core/src/kernel/store-worker.ts"),
      join(packages, "host/src/usage-worker.ts"),
      join(packages, "core/src/tools/support/image-resize-worker.ts"),
      join(packages, "tui/src/codemode-worker.ts"),
    ],
    root: packages,
    target: "bun",
    plugins: [solidPlugin, codemodePlugin],
    define: binaryDefines(process.env),
    compile: { outfile: executable, autoloadBunfig: false, autoloadDotenv: false },
  });

  if (!result.success) {
    throw new Error(
      result.logs.map((log) => log.message).join("\n") || "Bundle failed with empty logs",
    );
  }

  if (process.platform === "darwin") {
    const signed = spawnSync("codesign", ["--force", "--sign", "-", executable], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (signed.error) throw signed.error;

    if (signed.status !== 0) throw new Error(`codesign failed: ${signed.stderr.toString()}`);
  }

  // Publish only after compilation and signing succeed.
  await rename(executable, join(destination, name));
  process.stdout.write(
    `Built bin/${name} in ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
  );
} catch (cause) {
  process.stderr.write(`Build failed: ${describe(cause)}\n`);

  if (directory)
    process.stderr.write(await readFile(join(directory, "build.log"), "utf8").catch(() => ""));
  process.exitCode = 1;
} finally {
  if (directory)
    await rm(directory, { recursive: true, force: true }).catch((cause: unknown) => {
      process.stderr.write(
        `Build cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}\n`,
      );
      process.exitCode = 1;
    });
}
