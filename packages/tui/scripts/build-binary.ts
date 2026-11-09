import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import solidPlugin from "@opentui/solid/bun-plugin";
import { valid } from "semver";
import { VERSION } from "../src/version.ts";
import { codemodePlugin } from "./codemode-plugin.ts";
import { canvasShellPlugin } from "./canvas-shell-plugin.ts";
import { checksPlugin } from "./checks-plugin.ts";
import { BINARY_ENTRYPOINTS, binaryDefines } from "./defines.ts";
import { docsPlugin } from "./docs-plugin.ts";
import { photonPlugin } from "./photon-plugin.ts";

const destination = fileURLToPath(new URL("../dist/", import.meta.url));

const packages = fileURLToPath(new URL("../../", import.meta.url));

const name = process.platform === "win32" ? "nyte.exe" : "nyte";

const tailnet = process.platform === "win32" ? null : "nyte-tailnet";

const version = process.env["NYTE_RELEASE_VERSION"] ?? VERSION;

const started = performance.now();

function describe(cause: unknown): string {
  if (cause instanceof AggregateError) {
    return [cause.message, ...cause.errors.map((error) => describe(error))].join("\n");
  }

  return cause instanceof Error ? cause.message : String(cause);
}

let directory: string | undefined;

try {
  if (valid(version) !== version) throw new Error(`Invalid release version: ${version}`);
  await mkdir(destination, { recursive: true });
  directory = await mkdtemp(join(destination, ".nyte-build-"));
  const executable = join(directory, name);

  const result = await Bun.build({
    entrypoints: BINARY_ENTRYPOINTS.map((entry) => join(packages, entry)),
    root: packages,
    target: "bun",
    plugins: [
      solidPlugin,
      codemodePlugin,
      photonPlugin,
      docsPlugin,
      checksPlugin,
      canvasShellPlugin,
    ],
    define: { ...binaryDefines(process.env), NYTE_BUILT_VERSION: JSON.stringify(version) },
    format: "esm",
    minify: true,
    splitting: true,
    bytecode: true,
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

  if (tailnet !== null) {
    const built = spawnSync(
      process.execPath,
      [join(packages, "tailnet", "build.mjs"), join(directory, tailnet)],
      {
        env: { ...process.env, NYTE_RELEASE_VERSION: version },
        stdio: ["ignore", "inherit", "inherit"],
      },
    );

    if (built.error) throw built.error;

    if (built.status !== 0) throw new Error(`Building ${tailnet} failed.`);
    await rename(join(directory, tailnet), join(destination, tailnet));
  }

  await rename(executable, join(destination, name));
  await writeFile(join(destination, "nyte.version"), `${version}\n`);
  process.stdout.write(
    `Built packages/tui/dist/${name}${tailnet === null ? "" : ` and ${tailnet}`} in ${((performance.now() - started) / 1000).toFixed(1)}s\n`,
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
