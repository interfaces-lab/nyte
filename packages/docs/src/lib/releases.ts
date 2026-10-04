import { cacheLife } from "next/cache";
import { gitConfig, githubUrl } from "./shared";

export const releasesUrl = `${githubUrl}/releases`;

export interface MacRelease {
  version: string;
  notesUrl: string;
  downloadUrl: string;
}

/* The latest published release and its Apple Silicon disk image, rechecked hourly. */
export async function latestMacRelease(): Promise<MacRelease | null> {
  "use cache";
  cacheLife("hours");

  const response = await fetch(
    `https://api.github.com/repos/${gitConfig.user}/${gitConfig.repo}/releases/latest`,
  ).catch(() => null);
  if (!response?.ok) return null;

  const release: unknown = await response.json();
  if (typeof release !== "object" || release === null) return null;
  if (!("tag_name" in release) || typeof release.tag_name !== "string") return null;
  if (!("html_url" in release) || typeof release.html_url !== "string") return null;
  if (!("assets" in release) || !Array.isArray(release.assets)) return null;

  const assets: unknown[] = release.assets;
  for (const asset of assets) {
    if (typeof asset !== "object" || asset === null) continue;
    if (!("name" in asset) || typeof asset.name !== "string") continue;
    if (!asset.name.endsWith("-mac-arm64.dmg")) continue;
    if (!("browser_download_url" in asset) || typeof asset.browser_download_url !== "string")
      continue;
    return {
      version: release.tag_name,
      notesUrl: release.html_url,
      downloadUrl: asset.browser_download_url,
    };
  }
  return null;
}
