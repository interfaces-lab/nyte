import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative } from "node:path";
import process from "node:process";

import packageJson from "../package.json" with { type: "json" };

const REPOSITORY = "interfaces-lab/nyte";

const RELEASE_TARGETS = ["darwin-arm64", "linux-arm64", "linux-x64"];

export function platformTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform}-${arch}`;

  return RELEASE_TARGETS.includes(target) ? target : undefined;
}

export function releaseAssetName(version, target) {
  return `nyte-v${version.replace(/^v/u, "")}-${target}`;
}

function cacheRoot(env = process.env) {
  return env["NYTE_BIN_DIR"] ?? join(homedir(), ".nyte", "bin");
}

async function sha256(path) {
  const hash = createHash("sha256");
  hash.update(await readFile(path));

  return hash.digest("hex");
}

async function fetchOk(fetchFn, url) {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(10 * 60_000) });

  if (!response.ok) throw new Error(`Failed to download ${url} (HTTP ${response.status}).`);

  return response;
}

async function download(fetchFn, url, path) {
  const response = await fetchOk(fetchFn, url);
  await writeFile(path, new Uint8Array(await response.arrayBuffer()));
}

export async function ensureBinary(options = {}) {
  const version = options.version ?? packageJson.version;
  const target = platformTarget(options.platform, options.arch);

  if (target === undefined) {
    throw new Error(`Nyte has no native release for ${process.platform}/${process.arch}.`);
  }

  const root = options.root ?? cacheRoot(options.env);
  const binary = join(root, version, "nyte");

  if ((await stat(binary).catch(() => undefined))?.isFile()) {
    await linkCurrent(root, binary);

    return binary;
  }

  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const asset = releaseAssetName(version, target);
  const base = `https://github.com/${REPOSITORY}/releases/download/v${version}`;
  const versionDir = dirname(binary);
  const archive = join(versionDir, `${asset}.tar.gz`);
  await mkdir(versionDir, { recursive: true });

  try {
    const checksum = (await (await fetchOk(fetchFn, `${base}/${asset}.tar.gz.sha256`)).text())
      .trim()
      .split(/\s+/u)[0]
      ?.toLowerCase();

    if (checksum === undefined || !/^[0-9a-f]{64}$/u.test(checksum)) {
      throw new Error(`The checksum file for ${asset} is malformed.`);
    }

    await download(fetchFn, `${base}/${asset}.tar.gz`, archive);
    const actual = await sha256(archive);

    if (actual !== checksum) {
      throw new Error(`Checksum mismatch for ${asset}: expected ${checksum}, got ${actual}.`);
    }

    const result = spawn("tar", ["-xzf", archive, "-C", versionDir], { stdio: "inherit" });

    const exitCode = await new Promise((resolve, reject) => {
      result.once("error", reject);
      result.once("exit", (code, signal) => {
        if (signal !== null) reject(new Error(`tar exited from signal ${signal}.`));
        else resolve(code);
      });
    });

    if (exitCode !== 0 || !(await stat(binary).catch(() => undefined))?.isFile()) {
      throw new Error(`${asset}.tar.gz does not contain a nyte binary.`);
    }

    await chmod(binary, 0o755);
  } catch (error) {
    await rm(binary, { force: true });
    throw error;
  } finally {
    await rm(archive, { force: true });
  }

  await linkCurrent(root, binary);

  return binary;
}

async function linkCurrent(root, binary) {
  const link = join(root, "nyte");
  const target = relative(root, binary);

  if ((await readlink(link).catch(() => undefined)) === target) return;
  const temporary = `${link}.${process.pid}.tmp`;
  await rm(temporary, { force: true });
  await symlink(target, temporary);
  await rename(temporary, link);
}

export async function launch(args = process.argv.slice(2), options = {}) {
  const binary = await ensureBinary(options);
  const child = spawn(binary, args, { stdio: "inherit" });

  const forwardInt = () => {
    if (!child.killed) child.kill("SIGINT");
  };

  const forwardTerm = () => {
    if (!child.killed) child.kill("SIGTERM");
  };

  process.once("SIGINT", forwardInt);
  process.once("SIGTERM", forwardTerm);

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", forwardInt);
      process.removeListener("SIGTERM", forwardTerm);

      if (signal !== null) {
        process.kill(process.pid, signal);

        return;
      }

      resolve(code ?? 1);
    });
  });
}
