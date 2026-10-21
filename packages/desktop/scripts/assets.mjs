import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = fileURLToPath(new URL("../../../", import.meta.url));

const outputs = ["packages/canvas/dist", "packages/app/dist"];

async function sourceIdentity() {
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
    cwd: root,
    encoding: "utf8",
  });

  if (status.trim() !== "")
    throw new Error("Desktop assets require a clean checkout. Use a separate worktree.");

  for (const name of ["canvas", "app"]) {
    const entries = await readdir(join(root, "packages", name));

    if (
      entries.some((entry) =>
        [".env", ".env.local", ".env.production", ".env.production.local"].includes(entry),
      )
    )
      throw new Error(
        `Remove packages/${name}/.env build files and pass VITE_ configuration through the environment.`,
      );
  }

  return {
    commit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    lockfile: createHash("sha256")
      .update(await readFile(join(root, "pnpm-lock.yaml")))
      .digest("hex"),
    environment: Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.startsWith("VITE_")),
    ),
  };
}

function externalDirectory(directory) {
  const absolute = resolve(directory);
  const path = relative(root, absolute);

  if (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
    throw new Error("Keep the desktop asset bundle outside the checkout.");

  return absolute;
}

async function inventory(directory) {
  const files = [];

  async function visit(path) {
    const info = await lstat(join(directory, path));

    if (info.isDirectory()) {
      const entries = await readdir(join(directory, path));

      for (const entry of entries.sort()) {
        if (entry.includes("\\")) throw new Error(`Non-portable asset path: ${path}/${entry}`);
        await visit(`${path}/${entry}`);
      }

      return;
    }

    if (!info.isFile()) throw new Error(`Desktop assets must be regular files: ${path}`);
    files.push({
      path,
      sha256: createHash("sha256")
        .update(await readFile(join(directory, path)))
        .digest("hex"),
    });
  }

  for (const path of ["packages", "packages/canvas", "packages/app"]) {
    if (!(await lstat(join(directory, path))).isDirectory())
      throw new Error(`Desktop asset directory is not a regular directory: ${path}`);
  }

  for (const output of outputs) await visit(output);

  for (const entry of ["packages/canvas/dist/shell/index.html", "packages/app/dist/index.html"]) {
    if (!files.some((file) => file.path === entry))
      throw new Error(`Missing desktop asset: ${entry}`);
  }

  return files;
}

async function buildDesktopAssets(directory) {
  const destination = externalDirectory(directory);
  const identity = await sourceIdentity();
  await mkdir(destination);

  for (const name of ["canvas", "app"]) {
    const result = spawnSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["--dir", `packages/${name}`, "build"],
      {
        cwd: root,
        stdio: "inherit",
        shell: process.platform === "win32",
      },
    );

    if (result.error) throw result.error;

    if (result.status !== 0)
      throw new Error(`${name} build failed. No desktop assets were exported.`);
  }

  if (!isDeepStrictEqual(identity, await sourceIdentity()))
    throw new Error("The source or build configuration changed while building desktop assets.");

  for (const output of outputs)
    await cp(join(root, output), join(destination, output), { recursive: true });

  await writeFile(
    join(destination, "manifest.json"),
    `${JSON.stringify(
      {
        ...identity,
        files: await inventory(destination),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Desktop assets for ${identity.commit}: ${destination}\n`);
}

export async function restoreDesktopAssets(directory) {
  const source = externalDirectory(directory);
  const manifest = JSON.parse(await readFile(join(source, "manifest.json"), "utf8"));
  const expected = { ...(await sourceIdentity()), files: await inventory(source) };

  if (!isDeepStrictEqual(manifest, expected))
    throw new Error(
      "Desktop assets do not match this commit, lockfile, VITE_ configuration or file checksums. Rebuild the bundle from this checkout.",
    );

  for (const output of outputs) {
    await rm(join(root, output), { recursive: true, force: true });
    await cp(join(source, output), join(root, output), { recursive: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, directory, ...extra] = process.argv.slice(2);

  if (command === "--help") {
    process.stdout.write(
      "Usage: node packages/desktop/scripts/assets.mjs build <new-directory-outside-checkout>\n",
    );
  } else if (command !== "build" || directory === undefined || extra.length > 0) {
    process.stderr.write(
      "Usage: node packages/desktop/scripts/assets.mjs build <new-directory-outside-checkout>\n",
    );
    process.exitCode = 2;
  } else {
    await buildDesktopAssets(directory).catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
  }
}
