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
import { errorMessage } from "./lib/format.ts";
import {
  fetchLatestRelease,
  followedChannel,
  releaseChannel,
  REPO,
  saveChannel,
  supersedes,
  VERSION,
} from "./version.ts";
import type { UpdateChannel } from "./version.ts";

const execFileAsync = promisify(execFile);

export type UpdateOutcome =
  | { readonly kind: "updated"; readonly from: string; readonly to: string; readonly path: string }
  /** The version named is this build. */
  | { readonly kind: "current"; readonly version: string }
  /** The followed channel's newest release, `newest`, isn't newer than this build: nothing was installed until the channel passes it. */
  | { readonly kind: "waiting"; readonly channel: UpdateChannel; readonly newest: string }
  /** This install can't replace itself: it runs from source, or no release is built for this platform. Found before any network work. */
  | { readonly kind: "unsupported"; readonly blocker: "source" | "platform" }
  | { readonly kind: "failed"; readonly message: string };

/** What the update is doing, as data. Clients word it. */
export type UpdateProgress =
  /** Asking GitHub for the newest release on `channel`; a named version skips it. */
  | { readonly kind: "checking"; readonly channel: UpdateChannel }
  /** Updates now follow `channel`: saved before a channel's lookup, or after installing a version from another channel. */
  | { readonly kind: "switched"; readonly channel: UpdateChannel }
  | { readonly kind: "downloading"; readonly asset: string; readonly version: string }
  | { readonly kind: "percent"; readonly percent: number }
  | { readonly kind: "verified" };

interface UpdateOptions {
  /** A release to install (a leading `v` is fine), or `stable` or `nightly` to follow that channel; none follows the saved channel. */
  readonly target?: string | undefined;
  readonly report?: (event: UpdateProgress) => void;
  /** Aborts the release lookup and the download; the outcome is then `failed`. */
  readonly signal?: AbortSignal;
  /**
   * Runs before a named version older than this build downloads; a channel never installs one.
   * Without it the downgrade goes ahead. What it throws, `selfUpdate` throws.
   */
  readonly confirmDowngrade?: (version: string) => Promise<void>;
  /** The binary to replace. Defaults to the running compiled binary. */
  readonly binaryPath?: string;
}

/** `darwin-arm64`, the suffix of a release asset's name, or `undefined` when no release is built for this platform. */
function releasePlatform(): string | undefined {
  if (process.platform !== "darwin" && process.platform !== "linux") return undefined;

  if (process.arch !== "arm64" && process.arch !== "x64") return undefined;

  return `${process.platform}-${process.arch}`;
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
  | { readonly kind: "install"; readonly version: string }
  | Extract<UpdateOutcome, { readonly kind: "current" | "waiting" | "failed" }>;

/**
 * Decide what to install. A channel is saved first and installs only a release newer than this
 * build, so a store a newer build migrated stays readable; it waits for the channel to pass this
 * build instead. Only a named version can go back.
 */
async function resolveUpdateTarget(
  options: Pick<UpdateOptions, "target" | "signal">,
  report: (event: UpdateProgress) => void,
): Promise<UpdateTarget> {
  const target = options.target?.trim();

  if (target === "stable" || target === "nightly") {
    await follow(target, report);

    return newestOn(target, options.signal, report);
  }

  if (target !== undefined) {
    const version = valid(target.replace(/^v/u, ""));

    if (version === null) {
      return {
        kind: "failed",
        message: `"${target}" isn't a version like 0.2.0, stable or nightly.`,
      };
    }

    if (version === VERSION) return { kind: "current", version };

    return { kind: "install", version };
  }

  return newestOn(await followedChannel(), options.signal, report);
}

async function newestOn(
  channel: UpdateChannel,
  signal: AbortSignal | undefined,
  report: (event: UpdateProgress) => void,
): Promise<UpdateTarget> {
  report({ kind: "checking", channel });
  const latest = await fetchLatestRelease(channel, signal);

  if (!supersedes(latest.version, VERSION))
    return { kind: "waiting", channel, newest: latest.version };

  return { kind: "install", version: latest.version };
}

/**
 * Makes updates follow `channel` and reports `switched`. Writes only a change, so an update on the
 * followed channel never pins it for a build installed later from elsewhere.
 */
async function follow(
  channel: UpdateChannel,
  report: (event: UpdateProgress) => void,
): Promise<void> {
  if ((await followedChannel()) === channel) return;

  await saveChannel(channel);
  report({ kind: "switched", channel });
}

/** `signal` plus a timeout of `ms`. */
function bounded(ms: number, signal: AbortSignal | undefined): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(ms), ...(signal === undefined ? [] : [signal])]);
}

async function downloadTo(
  url: string,
  path: string,
  signal: AbortSignal | undefined,
  onProgress: (received: number, total: number | undefined) => void,
): Promise<string> {
  const response = await fetch(url, { signal: bounded(10 * 60_000, signal) });

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

async function fetchText(url: string, signal: AbortSignal | undefined): Promise<string> {
  const response = await fetch(url, { signal: bounded(30_000, signal) });

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
      (name !== "nyte" &&
        name !== "nyte-tailnet" &&
        name !== "VERSION" &&
        name !== "docs" &&
        !name.startsWith("docs/")) ||
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

/** Stages a release's docs beside the binary under `share/nyte/<version>`. `mkdir` reserves the version exclusively before the rename, since a rename alone can replace an existing empty directory, one a concurrent publisher created included. */
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

/** Downloads, verifies and installs a release over the running binary. The host runs the `nyte-tailnet` sidecar from beside the binary, so a release's sidecar is swapped in first. The new binary is staged in a private directory on the binary's filesystem and swapped in by one atomic rename once its docs are complete, leaving older versioned docs alone; a cleanup failure afterwards never turns that swap into a failed result. Updates then follow the installed version's channel; if that fails to save, the old channel stays followed and no `switched` is reported. */
export async function selfUpdate(options: UpdateOptions = {}): Promise<UpdateOutcome> {
  const report = options.report ?? (() => undefined);
  const binaryPath = options.binaryPath ?? installedBinaryPath();
  const platform = releasePlatform();

  if (binaryPath === undefined) return { kind: "unsupported", blocker: "source" };

  if (platform === undefined) return { kind: "unsupported", blocker: "platform" };

  const target = await resolveUpdateTarget(options, report).catch(
    (cause: unknown): UpdateTarget => ({ kind: "failed", message: errorMessage(cause) }),
  );

  if (target.kind !== "install") return target;

  if (supersedes(VERSION, target.version)) await options.confirmDowngrade?.(target.version);
  const asset = `nyte-v${target.version}-${platform}`;
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
    report({ kind: "downloading", asset: `${asset}.tar.gz`, version: target.version });
    const expected = parseSha256(await fetchText(`${base}/${asset}.tar.gz.sha256`, options.signal));

    if (expected === undefined) {
      return { kind: "failed", message: `The checksum file for ${asset} is malformed.` };
    }

    const archive = join(workDir, `${asset}.tar.gz`);
    let lastPercent = -1;

    const actual = await downloadTo(
      `${base}/${asset}.tar.gz`,
      archive,
      options.signal,
      (got, total) => {
        if (total === undefined || total <= 0) return;
        const percent = Math.floor((got / total) * 10) * 10;

        if (percent > lastPercent && percent < 100) {
          lastPercent = percent;
          report({ kind: "percent", percent });
        }
      },
    );

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

    if (plan.files.includes("nyte-tailnet")) {
      const tailnet = join(adjacent, "nyte-tailnet");
      await copyFile(join(extracted, "nyte-tailnet"), tailnet);
      await chmod(tailnet, 0o755);
      await rename(tailnet, join(installDir, "nyte-tailnet"));
    }

    await rename(staged, installed);
    await follow(releaseChannel(target.version), report).catch(() => undefined);

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
    if (workDir !== undefined) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }

    if (adjacent !== undefined) {
      await rm(adjacent, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/** What a lookup on `channel` that found nothing newer than this build says; shared with `nyte update --check`. */
export function latestReleaseText(channel: UpdateChannel): string {
  if (releaseChannel(VERSION) !== channel)
    return `No ${channel} release is newer than nyte ${VERSION}.`;

  return `nyte ${VERSION} is the latest ${channel === "nightly" ? "nightly" : "release"}.`;
}

/** One line per outcome, shared by `nyte update` and `/update`. */
export function describeUpdateOutcome(outcome: UpdateOutcome): string {
  switch (outcome.kind) {
    case "updated":
      return `Updated nyte ${outcome.from} → ${outcome.to} at ${outcome.path}. Restart nyte to use it.`;
    case "current":
      return `nyte ${outcome.version} is already installed.`;
    case "waiting":
      return latestReleaseText(outcome.channel);
    case "unsupported":
      return outcome.blocker === "source"
        ? "Can't update nyte when it runs from source. Run git pull in the checkout instead."
        : `Can't update nyte on ${process.platform}/${process.arch}. No release is built for it.`;
    case "failed":
      return outcome.message;
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}
