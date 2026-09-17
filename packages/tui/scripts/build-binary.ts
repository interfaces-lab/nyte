/**
 * Compiles the TUI into `bin/nyte`. `Bun.build` rather than the CLI because
 * the Solid JSX transform is a bundler plugin. Two entries: the app and the
 * store worker, named from `packages/` so the binary embeds the worker at
 * `/$bunfs/root/core/src/kernel/store-worker.js`, where `src/host.ts` opens it.
 */
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import solidPlugin from "@opentui/solid/bun-plugin";

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
    return [cause.message, ...cause.errors.map((error: unknown) => describe(error))].join("\n");
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
    ],
    root: packages,
    target: "bun",
    plugins: [solidPlugin],
    // `@opentui/core` selects its native module by reading OPENTUI_LIBC, and pnpm
    // installs only the host's libc variant. Left dynamic, the bundler has to
    // resolve both branches and fails on the absent one; pinning the value lets
    // dead code elimination drop the branch this binary cannot use. Set
    // OPENTUI_LIBC=musl in the environment to compile against musl instead.
    define: { "process.env.OPENTUI_LIBC": JSON.stringify(process.env["OPENTUI_LIBC"] ?? "glibc") },
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
