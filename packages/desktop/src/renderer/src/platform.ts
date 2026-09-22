import type { HostState } from "../../shared/ipc.ts";

/** Platform-dependent chrome must not wait for the first host IPC round trip. */
export function macPlatform(platform: HostState["platform"] | undefined): boolean {
  if (platform !== undefined) return platform === "darwin";
  const bootPlatform = document.documentElement.dataset["platform"];

  if (bootPlatform !== undefined) return bootPlatform === "darwin";

  return navigator.userAgent.includes("Macintosh");
}
