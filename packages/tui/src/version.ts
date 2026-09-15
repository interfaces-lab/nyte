/** Based on https://github.com/earendil-works/pi/blob/main/packages/coding-agent/src/utils/version-check.ts */
import process from "node:process";
import { gt, valid } from "semver";
import { toJsonValue } from "@nyte-ai/core/store";
import packageMetadata from "../package.json" with { type: "json" };
import { isJsonObject, isJsonString } from "./json.ts";

export const REPO = "interfaces-lab/nyte";
const LATEST_RELEASE_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

export const VERSION = packageMetadata.version;

interface ReleaseInfo {
  /** Semver without the leading `v`. */
  readonly version: string;
  readonly url: string;
}

export function isNewerVersion(candidate: string, current: string): boolean {
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
    const response = await fetchFn(LATEST_RELEASE_URL, {
      headers: githubHeaders(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return undefined;
    const data = toJsonValue(await response.json());
    if (!isJsonObject(data)) return undefined;
    const tag = data["tag_name"];
    if (!isJsonString(tag)) return undefined;
    const version = valid(tag.trim().replace(/^v/u, ""));
    if (version === null) return undefined;
    const html = data["html_url"];
    const url =
      isJsonString(html) && html.startsWith(`https://github.com/${REPO}/releases/`)
        ? html
        : RELEASES_URL;
    return { version, url };
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
  if (latest === undefined || !isNewerVersion(latest.version, VERSION)) return undefined;
  return latest;
}
