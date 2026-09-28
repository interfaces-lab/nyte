/**
 * Self-update for the compiled `nyte` binary. Downloads the release tarball
 * for this platform, verifies its sha256, and swaps the binary in place with
 * one rename. A build running from source has no binary to replace and is
 * told so.
 *
 * Release assets are the ones `scripts/package.sh` stages:
 * `nyte-v<version>-<os>-<arch>.tar.gz` plus a `.sha256` beside it.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, lstatSync } from "node:fs";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { valid } from "semver";
import { fetchLatestRelease, isNewerVersion, REPO, VERSION } from "./version.ts";

const execFileAsync = promisify(execFile);

export type UpdateOutcome =
  | { readonly kind: "updated"; readonly from: string; readonly to: string; readonly path: string }
  | { readonly kind: "current"; readonly version: string }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "failed"; readonly message: string };

/** What the update is doing, as data. Clients word it. */
export type UpdateProgress =
  | { readonly kind: "downloading"; readonly asset: string }
  | { readonly kind: "percent"; readonly percent: number }
  | { readonly kind: "verified" };

interface UpdateOptions {
  /** Install this release instead of the newest one. A leading `v` is fine. */
  readonly version?: string;
  readonly report?: (event: UpdateProgress) => void;
  readonly fetchFn?: typeof globalThis.fetch;
  /** The binary to replace. Defaults to the running compiled binary. */
  readonly binaryPath?: string;
}

/** `nyte-v0.2.0-darwin-arm64`, or `undefined` when no release is built for the platform. */
function releaseAssetName(
  version: string,
  platform: string = process.platform,
  arch: string = process.arch,
): string | undefined {
  const os = platform === "darwin" || platform === "linux" ? platform : undefined;
  const cpu = arch === "arm64" || arch === "x64" ? arch : undefined;

  if (os === undefined || cpu === undefined) return undefined;

  return `nyte-v${version.replace(/^v/u, "")}-${os}-${cpu}`;
}

/** The hex digest from a `sha256sum`/`shasum` line: `<hex>  <file>`. */
function parseSha256(text: string): string | undefined {
  const digest = text.trim().split(/\s+/u)[0]?.toLowerCase();

  return digest !== undefined && /^[0-9a-f]{64}$/u.test(digest) ? digest : undefined;
}

/**
 * The compiled binary's path, or `undefined` when running from source. A Bun
 * standalone executable serves its modules from the `/$bunfs/` virtual
 * filesystem and reports itself as `process.execPath`.
 */
function installedBinaryPath(
  moduleUrl: string = import.meta.url,
  execPath: string = process.execPath,
): string | undefined {
  const runtime = basename(execPath).toLowerCase();

  if (moduleUrl.includes("/$bunfs/")) return execPath;

  if (runtime === "bun" || runtime === "node" || runtime === "bun.exe" || runtime === "node.exe") {
    return undefined;
  }

  return execPath;
}

type UpdateTarget =
  | { readonly kind: "install"; readonly version: string; readonly explicit: boolean }
  | { readonly kind: "current"; readonly version: string }
  | { readonly kind: "failed"; readonly message: string };

/** Decide what to install: an explicit version wins; otherwise the latest when it is newer. */
async function resolveUpdateTarget(
  options: Pick<UpdateOptions, "version" | "fetchFn">,
  current: string = VERSION,
): Promise<UpdateTarget> {
  if (options.version !== undefined) {
    const version = valid(options.version.trim().replace(/^v/u, ""));

    if (version === null) {
      return { kind: "failed", message: `"${options.version}" isn't a version like 0.2.0.` };
    }

    if (version === current) return { kind: "current", version };

    return { kind: "install", version, explicit: true };
  }

  const latest = await fetchLatestRelease(options.fetchFn);

  if (latest === undefined) {
    return {
      kind: "failed",
      message: `Couldn't read the latest release from https://github.com/${REPO}/releases.`,
    };
  }

  if (!isNewerVersion(latest.version, current)) return { kind: "current", version: current };

  return { kind: "install", version: latest.version, explicit: false };
}

async function downloadTo(
  fetchFn: typeof globalThis.fetch,
  url: string,
  path: string,
  onProgress: (received: number, total: number | undefined) => void,
): Promise<string> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(10 * 60_000) });

  if (!response.ok || response.body === null) {
    throw new UpdateError(
      `Release download failed (HTTP ${String(response.status)}). Check that the release exists and try again.`,
    );
  }

  const length = response.headers.get("content-length");
  const total = length === null ? undefined : Number(length);
  const hash = createHash("sha256");
  let received = 0;
  const body = Readable.fromWeb(response.body);
  body.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    received += chunk.length;
    onProgress(received, total);
  });
  await pipeline(body, createWriteStream(path));

  return hash.digest("hex");
}

async function fetchText(fetchFn: typeof globalThis.fetch, url: string): Promise<string> {
  const response = await fetchFn(url, { signal: AbortSignal.timeout(30_000) });

  if (!response.ok) {
    throw new UpdateError(
      `Release download failed (HTTP ${String(response.status)}). Check that the release exists and try again.`,
    );
  }

  return response.text();
}

class UpdateError extends Error {}

/** Inspect the archive before tar is allowed to write anything. Tar resolves PAX
 * names for both listings; only regular files and directories may be extracted. */
async function planArchive(archive: string) {
  const listing = await execFileAsync("tar", ["-tzf", archive]);
  const verbose = await execFileAsync("tar", ["-tvzf", archive]);
  const names = listing.stdout.trimEnd().split("\n");
  const entries = verbose.stdout.trimEnd().split("\n");

  if (names.length !== entries.length) throw new UpdateError("The release archive is malformed.");
  const files: string[] = [];
  const seen = new Set<string>();

  for (const [index, raw] of names.entries()) {
    const name = raw.replace(/^\.\//u, "").replace(/\/$/u, "");
    const type = entries[index]?.[0];

    if (
      !/^[a-zA-Z0-9._/-]+$/u.test(name) ||
      name.split("/").some((part) => part === ".." || part === "." || part === "") ||
      (name !== "nyte" && name !== "VERSION" && name !== "docs" && !name.startsWith("docs/")) ||
      (type !== "-" && type !== "d") ||
      (type === "d" && name !== "docs" && !name.startsWith("docs/")) ||
      seen.has(name)
    ) {
      throw new UpdateError("The release archive contains unsafe or unsupported entries.");
    }

    seen.add(name);

    if (type === "-") files.push(name);
  }

  if (!files.includes("nyte")) {
    throw new UpdateError("The release archive does not contain a nyte binary.");
  }

  const docs = names.some((name) => name.replace(/^\.\//u, "").startsWith("docs"));

  if (docs && (!files.includes("docs/README.md") || !files.includes("VERSION"))) {
    throw new UpdateError("The release archive is missing its documentation index or version.");
  }

  return { files, docs };
}

async function pathStat(path: string) {
  return lstatSync(path, { throwIfNoEntry: false });
}

/** The existing install root is trusted and canonicalized, including system aliases.
 * Below it, docs directories must be plain directories. The install root must
 * not be renamed or modified by another writer during an update. */
async function checkDestination(path: string, root: string): Promise<void> {
  if (path === root) return;
  const parent = dirname(path);

  if (parent === path) throw new UpdateError("The docs destination is outside the install root.");
  await checkDestination(parent, root);
  const entry = await pathStat(path);

  if (entry?.isSymbolicLink() || (entry !== undefined && !entry.isDirectory())) {
    throw new UpdateError("The update destination is not a plain directory.");
  }
}

async function checkMatchingDocs(source: string, destination: string): Promise<void> {
  const entry = await pathStat(destination);

  if (!entry?.isDirectory() || entry.isSymbolicLink()) {
    throw new UpdateError("Existing documentation conflicts with this release.");
  }

  const sourceNames = (await readdir(source)).toSorted();
  const destinationNames = (await readdir(destination)).toSorted();

  if (sourceNames.join("\n") !== destinationNames.join("\n")) {
    throw new UpdateError("Existing documentation conflicts with this release.");
  }

  for (const name of sourceNames) {
    const from = join(source, name);
    const to = join(destination, name);

    if ((await lstat(from)).isDirectory()) {
      await checkMatchingDocs(from, to);
      continue;
    }

    const existing = await lstat(to);

    if (!existing.isFile() || !(await readFile(from)).equals(await readFile(to))) {
      throw new UpdateError("Existing documentation conflicts with this release.");
    }
  }
}

async function stageDocs(source: string, binaryPath: string, version: string) {
  const parent = resolve(dirname(binaryPath), "../share/nyte");
  const destination = join(parent, version);
  await checkDestination(destination, dirname(dirname(binaryPath)));

  if (await pathStat(destination)) {
    await checkMatchingDocs(source, join(destination, "docs"));

    return;
  }

  await mkdir(parent, { recursive: true });
  const stage = await mkdtemp(join(parent, ".nyte-update-"));

  try {
    await cp(source, join(stage, "docs"), { recursive: true, errorOnExist: true, force: false });
    // mkdir reserves this version exclusively. rename alone can replace an
    // existing empty directory, including one created by a concurrent publisher.
    await checkDestination(destination, dirname(dirname(binaryPath)));

    try {
      await mkdir(destination, { mode: 0o700 });
    } catch (cause) {
      if (!(cause instanceof Error && "code" in cause && cause.code === "EEXIST")) throw cause;
      await checkDestination(destination, dirname(dirname(binaryPath)));
      await checkMatchingDocs(source, join(destination, "docs"));

      return;
    }

    await rename(join(stage, "docs"), join(destination, "docs"));
    await chmod(destination, 0o755);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

export async function selfUpdate(options: UpdateOptions = {}): Promise<UpdateOutcome> {
  const report = options.report ?? (() => undefined);
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const binaryPath = options.binaryPath ?? installedBinaryPath();

  if (binaryPath === undefined) {
    return {
      kind: "unsupported",
      reason: "nyte is running from source. Update with git pull, not nyte update.",
    };
  }

  const target = await resolveUpdateTarget({ version: options.version, fetchFn });

  if (target.kind !== "install") return target;
  const asset = releaseAssetName(target.version);

  if (asset === undefined) {
    return {
      kind: "unsupported",
      reason: `No release is built for ${process.platform}/${process.arch}.`,
    };
  }

  const base = `https://github.com/${REPO}/releases/download/v${target.version}`;
  let workDir: string | undefined;
  let adjacent: string | undefined;

  try {
    const installDir = await realpath(dirname(binaryPath));
    const installed = join(installDir, basename(binaryPath));
    const binary = await pathStat(installed);

    if (!binary?.isFile() || binary.isSymbolicLink()) {
      throw new UpdateError("The update target is not a plain binary file.");
    }

    workDir = await mkdtemp(join(tmpdir(), "nyte-update-"));
    report({ kind: "downloading", asset: `${asset}.tar.gz` });
    const expected = parseSha256(await fetchText(fetchFn, `${base}/${asset}.tar.gz.sha256`));

    if (expected === undefined) {
      return { kind: "failed", message: `The checksum file for ${asset} is malformed.` };
    }

    const archive = join(workDir, `${asset}.tar.gz`);
    let lastPercent = -1;

    const actual = await downloadTo(fetchFn, `${base}/${asset}.tar.gz`, archive, (got, total) => {
      if (total === undefined || total <= 0) return;
      const percent = Math.floor((got / total) * 10) * 10;

      if (percent > lastPercent && percent < 100) {
        lastPercent = percent;
        report({ kind: "percent", percent });
      }
    });

    if (actual !== expected) {
      return {
        kind: "failed",
        message: `Checksum mismatch for ${asset}.tar.gz: expected ${expected}, got ${actual}.`,
      };
    }

    report({ kind: "verified" });

    const plan = await planArchive(archive);
    const extracted = join(workDir, "extracted");
    await mkdir(extracted);
    await execFileAsync("tar", [
      "-xzf",
      archive,
      "-C",
      extracted,
      "--no-same-owner",
      "--no-same-permissions",
    ]);

    for (const file of plan.files) {
      if (!(await lstat(join(extracted, file))).isFile()) {
        throw new UpdateError("The release archive contains an invalid file.");
      }
    }

    if (
      plan.files.includes("VERSION") &&
      (await readFile(join(extracted, "VERSION"), "utf8")).trim() !== target.version
    ) {
      throw new UpdateError(
        "The release documentation version does not match the requested release.",
      );
    }

    adjacent = await mkdtemp(join(installDir, ".nyte-update-"));
    const staged = join(adjacent, "nyte");
    await copyFile(join(extracted, "nyte"), staged);
    await chmod(staged, 0o755);

    if (plan.docs) await stageDocs(join(extracted, "docs"), installed, target.version);
    // The private staging directory shares the binary's filesystem. Docs are
    // complete before this atomic swap; older versioned docs remain untouched.
    await rename(staged, installed);

    return { kind: "updated", from: VERSION, to: target.version, path: binaryPath };
  } catch (cause) {
    const message =
      cause instanceof UpdateError
        ? cause.message
        : "Update download or installation failed. Check your connection and available disk space, then try again.";

    const hint =
      cause instanceof Error &&
      "code" in cause &&
      (cause.code === "EACCES" || cause.code === "EPERM")
        ? ` Can't write ${binaryPath}; rerun with permission to that directory.`
        : "";

    return { kind: "failed", message: `${message}${hint}` };
  } finally {
    // Cleanup failure must not turn a completed atomic swap into a failed result.
    if (workDir !== undefined) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }

    if (adjacent !== undefined) {
      await rm(adjacent, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** One line per outcome, shared by `nyte update` and `/update`. */
export function describeUpdateOutcome(outcome: UpdateOutcome): string {
  switch (outcome.kind) {
    case "updated":
      return `Updated nyte ${outcome.from} → ${outcome.to} at ${outcome.path}. Restart nyte to use it.`;
    case "current":
      return `nyte ${outcome.version} is the latest release.`;
    case "unsupported":
      return outcome.reason;
    case "failed":
      return outcome.message;
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}
