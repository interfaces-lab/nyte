/**
 * Builds the User-Agent string Nyte sends on provider requests. OS details are loaded through `process.getBuiltinModule` so the module stays browser-safe.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/pi-user-agent.ts
 * Synced with pi 7ebf9087e.
 */
function loadNodeOs() {
  if (typeof process === "undefined" || !(process.versions?.node || process.versions?.bun)) {
    return null;
  }

  return process.getBuiltinModule?.("node:os") ?? null;
}

// Keep runtime OS loading browser-safe. A top-level runtime import of node:os breaks browser/Vite builds.
const nodeOs = loadNodeOs();

export function getNyteUserAgent(): string {
  return nodeOs
    ? `nyte (${nodeOs.platform()} ${nodeOs.release()}; ${nodeOs.arch()})`
    : "nyte (browser)";
}
