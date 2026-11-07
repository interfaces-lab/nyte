import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { isJsonObject } from "@nyte-ai/schema";
import { gt, prerelease, valid } from "semver";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import packageMetadata from "../package.json" with { type: "json" };
import { toJson } from "./json.ts";
import { errorMessage } from "./lib/format.ts";

export const REPO = "interfaces-lab/nyte";

const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

const NIGHTLY_RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=100`;

const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

declare const NYTE_BUILT_VERSION: string | undefined;

export const VERSION =
  typeof NYTE_BUILT_VERSION === "string" ? NYTE_BUILT_VERSION : packageMetadata.version;

export type UpdateChannel = "stable" | "nightly";

/** Nightly versions carry their channel; every other build, betas included, follows stable. */
export function releaseChannel(version: string): UpdateChannel {
  return prerelease(version)?.[0] === "nightly" ? "nightly" : "stable";
}

/** The shape of the desktop's `UpdateSettingsStore` file. */
const updateSettings = Compile(
  Type.Object({ channel: Type.Enum(["stable", "nightly"]) }, { additionalProperties: false }),
);

function updateSettingsPath(): string {
  return join(process.env["NYTE_HOME"] ?? join(homedir(), ".nyte"), "updates.json");
}

/**
 * The channel updates follow: the one `~/.nyte/updates.json` saved, else this build's own. A
 * missing or invalid file is this build's channel.
 */
export async function followedChannel(): Promise<UpdateChannel> {
  const saved = await readFile(updateSettingsPath(), "utf8")
    .then((text) => toJson(JSON.parse(text)))
    .catch(() => undefined);

  return updateSettings.Check(saved) ? saved.channel : releaseChannel(VERSION);
}

/** Saves the channel updates follow, replacing the file in one rename. */
export async function saveChannel(channel: UpdateChannel): Promise<void> {
  const path = updateSettingsPath();
  const temporary = `${path}.tmp`;

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify({ channel })}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

interface ReleaseInfo {
  /** Semver without the leading `v`. */
  readonly version: string;
  readonly url: string;
}

export function supersedes(candidate: string, current: string): boolean {
  const candidateVersion = valid(candidate.trim());
  const currentVersion = valid(current.trim());

  return (
    candidateVersion !== null && currentVersion !== null && gt(candidateVersion, currentVersion)
  );
}

function githubHeaders(): Record<"accept" | "User-Agent" | "X-GitHub-Api-Version", string> {
  return {
    accept: "application/vnd.github+json",
    "User-Agent": `nyte/${VERSION}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

const RELEASES_UNREADABLE = `Couldn't read the latest release from https://github.com/${REPO}/releases.`;

const UPDATE_CHECK_SWITCHES = ["NYTE_OFFLINE", "NYTE_SKIP_VERSION_CHECK"] as const;

/**
 * The newest published release on `channel`. Throws when GitHub can't be reached or answers without
 * one, and with `signal`'s reason once it aborts.
 */
export async function fetchLatestRelease(
  channel: UpdateChannel,
  signal?: AbortSignal,
): Promise<ReleaseInfo> {
  const nightly = channel === "nightly";
  const fail = (cause: unknown): never => unreachable(cause, signal);

  const response = await fetch(nightly ? NIGHTLY_RELEASES_URL : LATEST_RELEASE_URL, {
    headers: githubHeaders(),
    signal: AbortSignal.any([
      AbortSignal.timeout(10_000),
      ...(signal === undefined ? [] : [signal]),
    ]),
  }).catch(fail);

  if (!response.ok) throw new Error(RELEASES_UNREADABLE);
  const data = toJson(await response.json().catch(fail));
  const releases = nightly ? (Array.isArray(data) ? data : []) : [data];
  let latest: ReleaseInfo | undefined;

  for (const release of releases) {
    if (!isJsonObject(release) || release["draft"] === true) continue;
    const tag = release["tag_name"];

    if (typeof tag !== "string") continue;
    const version = valid(tag.trim().replace(/^v/u, ""));

    if (version === null) continue;
    const tagChannel = prerelease(version)?.[0];

    if (nightly ? tagChannel !== "nightly" : tagChannel !== undefined) continue;

    if (latest !== undefined && !supersedes(version, latest.version)) continue;
    const html = release["html_url"];

    const url =
      typeof html === "string" && html.startsWith(`https://github.com/${REPO}/releases/`)
        ? html
        : nightly
          ? `https://github.com/${REPO}/releases/tag/v${version}`
          : RELEASES_URL;

    latest = { version, url };
  }

  if (latest === undefined) throw new Error(RELEASES_UNREADABLE);

  return latest;
}

/** Bun's network errors carry a code and a hint about `verbose`; the code alone is the cause. */
function unreachable(cause: unknown, signal: AbortSignal | undefined): never {
  signal?.throwIfAborted();

  const reason =
    cause instanceof Error && cause.name === "TimeoutError"
      ? "github.com didn't answer within 10 s"
      : cause instanceof Error && "code" in cause
        ? `The connection failed with ${String(cause.code)}`
        : errorMessage(cause).replace(/\.$/u, "");

  throw new Error(`Couldn't reach github.com to check for updates. ${reason}.`);
}

/**
 * A newer release on the channel updates follow, or `undefined` when none is newer than this build.
 * Throws when the user turned network checks off or GitHub can't be read, and with `signal`'s
 * reason once it aborts.
 */
export async function findUpdate(signal?: AbortSignal): Promise<ReleaseInfo | undefined> {
  const switchedOff = UPDATE_CHECK_SWITCHES.find((name) => process.env[name] !== undefined);

  if (switchedOff !== undefined) {
    throw new Error(`Can't check for updates while ${switchedOff} is set.`);
  }

  const latest = await fetchLatestRelease(await followedChannel(), signal);

  return supersedes(latest.version, VERSION) ? latest : undefined;
}

/** `findUpdate` for passive notices: a check that is off or fails shows nothing. */
export async function checkForUpdate(): Promise<ReleaseInfo | undefined> {
  return findUpdate().catch(() => undefined);
}
