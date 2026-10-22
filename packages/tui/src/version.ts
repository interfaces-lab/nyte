import process from "node:process";
import { isJsonObject } from "@nyte-ai/schema";
import { gt, prerelease, valid } from "semver";
import packageMetadata from "../package.json" with { type: "json" };
import { toJson } from "./json.ts";

export const REPO = "interfaces-lab/nyte";

const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

const NIGHTLY_RELEASES_URL = `https://api.github.com/repos/${REPO}/releases?per_page=100`;

const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

declare const NYTE_BUILT_VERSION: string | undefined;

export const VERSION =
  typeof NYTE_BUILT_VERSION === "string" ? NYTE_BUILT_VERSION : packageMetadata.version;

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

/** The newest published release, or `undefined` when GitHub cannot be reached or answers oddly. */
export async function fetchLatestRelease(
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<ReleaseInfo | undefined> {
  try {
    const nightly = prerelease(VERSION)?.[0] === "nightly";

    const response = await fetchFn(nightly ? NIGHTLY_RELEASES_URL : LATEST_RELEASE_URL, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return undefined;
    const data = toJson(await response.json());
    const releases = nightly ? (Array.isArray(data) ? data : []) : [data];
    let latest: ReleaseInfo | undefined;

    for (const release of releases) {
      if (!isJsonObject(release) || release["draft"] === true) continue;
      const tag = release["tag_name"];

      if (typeof tag !== "string") continue;
      const version = valid(tag.trim().replace(/^v/u, ""));

      if (version === null) continue;
      const channel = prerelease(version)?.[0];

      if (nightly ? channel !== "nightly" : channel !== undefined) continue;

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

    return latest;
  } catch {
    return undefined;
  }
}

/** A newer release than the running build, unless the user opted out of network checks. */
export async function checkForUpdate(
  fetchFn: typeof globalThis.fetch = globalThis.fetch,
): Promise<ReleaseInfo | undefined> {
  if (
    process.env["NYTE_OFFLINE"] !== undefined ||
    process.env["NYTE_SKIP_VERSION_CHECK"] !== undefined
  ) {
    return undefined;
  }

  const latest = await fetchLatestRelease(fetchFn);

  if (latest === undefined || !supersedes(latest.version, VERSION)) return undefined;

  return latest;
}
