/** Browser panel decisions that need no Electron; `browser.ts` applies them. */
import type { BrowserSurfaceState } from "../shared/ipc.ts";

const NET_ERROR_ABORTED = -3;

const ALLOWED_PERMISSIONS: ReadonlySet<string> = new Set([
  "fullscreen",
  "clipboard-sanitized-write",
]);

export function webUrl(input: string): string | undefined {
  let url: URL;

  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }

  return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
}

/** Dev servers rarely speak TLS, so local and intranet hosts stay plain. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  if (host === "[::1]" || host === "::1") return true;

  if (host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) return true;

  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;

  return !host.includes(".");
}

export function httpsUpgrade(url: string, plainHosts: ReadonlySet<string>): string | undefined {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "http:") return undefined;

  if (isLocalHost(parsed.hostname) || plainHosts.has(parsed.host)) return undefined;
  parsed.protocol = "https:";

  if (parsed.port === "80") parsed.port = "";

  return parsed.href;
}

export function plainRetry(
  failedUrl: string,
  upgradedFrom: string | undefined,
  errorCode: number,
): string | undefined {
  if (upgradedFrom === undefined || errorCode === NET_ERROR_ABORTED) return undefined;

  return failedUrl.startsWith("https:") ? upgradedFrom : undefined;
}

export function permissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}

export function surfaceSecurity(url: string): BrowserSurfaceState["secure"] {
  if (url.startsWith("https:")) return "https";

  if (url.startsWith("http:")) return "http";

  return "none";
}
