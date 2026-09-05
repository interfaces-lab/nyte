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
import { createWriteStream } from "node:fs";
import { chmod, copyFile, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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

export interface UpdateOptions {
  /** Install this release instead of the newest one. A leading `v` is fine. */
  readonly version?: string;
  readonly report?: (event: UpdateProgress) => void;
  readonly fetchFn?: typeof globalThis.fetch;
  /** The binary to replace. Defaults to the running compiled binary. */
  readonly binaryPath?: string;
}

/** `nyte-v0.2.0-darwin-arm64`, or `undefined` when no release is built for the platform. */
export function releaseAssetName(
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
export function installedBinaryPath(
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

export type UpdateTarget =
  | { readonly kind: "install"; readonly version: string; readonly explicit: boolean }
  | { readonly kind: "current"; readonly version: string }
  | { readonly kind: "failed"; readonly message: string };

/** Decide what to install: an explicit version wins; otherwise the latest when it is newer. */
export async function resolveUpdateTarget(
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
    throw new Error(`Failed to download ${url} (HTTP ${String(response.status)}).`);
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
  if (!response.ok) throw new Error(`Failed to download ${url} (HTTP ${String(response.status)}).`);
  return response.text();
}

function isPermissionError(cause: unknown): cause is { readonly code: "EACCES" | "EPERM" } {
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause.code === "EACCES" || cause.code === "EPERM")
  );
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
  const workDir = await mkdtemp(join(tmpdir(), "nyte-update-"));
  const staged = join(dirname(binaryPath), `.nyte-update-${String(process.pid)}`);
  try {
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

    await execFileAsync("tar", ["-xzf", archive, "-C", workDir]);
    const extracted = join(workDir, "nyte");
    if (!(await stat(extracted).catch(() => undefined))?.isFile()) {
      return { kind: "failed", message: `${asset}.tar.gz does not contain a nyte binary.` };
    }
    await copyFile(extracted, staged);
    await chmod(staged, 0o755);
    // Same directory, so the rename is atomic. The running process keeps its
    // old inode mapped; the next launch gets the new file.
    await rename(staged, binaryPath);
    return { kind: "updated", from: VERSION, to: target.version, path: binaryPath };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const hint = isPermissionError(cause)
      ? ` Can't write ${binaryPath}; rerun with permission to that directory.`
      : "";
    return { kind: "failed", message: `${message}${hint}` };
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(staged, { force: true });
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
