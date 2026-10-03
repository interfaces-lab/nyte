/**
 * The server the web app talks to, entered by hand or opened from a pairing
 * link, and remembered in this browser. The address rules match the iOS app:
 * HTTPS anywhere, plain HTTP only toward a local or Tailscale address.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { Connection } from "./bridge.ts";

const STORAGE_KEY = "nyte:connection";

const ConnectionSchema = Type.Object(
  {
    url: Type.String({ minLength: 1 }),
    token: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

/**
 * Plain HTTP is allowed only toward loopback, private IPv4 ranges, and the
 * Tailscale range, checked numerically. 100.64.0.0/10 is shared address space
 * rather than a private network; reaching one means this device is already
 * inside an authenticated tailnet.
 */
function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]" || hostname.endsWith(".local")) return true;

  if (hostname.endsWith(".ts.net")) return true;
  const octets = hostname.split(".").map(Number);

  if (octets.length !== 4) return false;

  if (!octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return false;
  const [a, b] = octets;

  if (a === undefined || b === undefined) return false;

  if (a === 100 && b >= 64 && b <= 127) return true;

  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}

export function parseConnection(value: Connection): Connection {
  const token = value.token.trim();

  if (!token || value.url.trim() === "") throw new Error("Enter the address and the token.");
  let url: URL;

  try {
    url = new URL(value.url.trim());
  } catch {
    throw new Error("Enter the full address, including http:// or https://.");
  }

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isPrivateHost(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP with your Mac's local or Tailscale address.");
  }

  // The browser blocks HTTP requests from an HTTPS page, so the hosted app can only reach HTTPS.
  if (url.protocol === "http:" && location.protocol === "https:") {
    throw new Error(
      "This page is served over HTTPS, so it needs an HTTPS address, such as one from Tailscale HTTPS.",
    );
  }

  if (url.username || url.password || url.search || url.hash)
    throw new Error("Enter only the address. The token has its own field.");

  return { url: url.href.replace(/\/$/, ""), token };
}

/** Host address without scheme or path. */
export function displayAddress(connection: Connection): string {
  return new URL(connection.url).host;
}

export function loadConnection(): Connection | undefined {
  const text = localStorage.getItem(STORAGE_KEY);

  if (text === null) return undefined;

  try {
    const value: unknown = JSON.parse(text);

    return Value.Check(ConnectionSchema, value) ? parseConnection(value) : undefined;
  } catch {
    return undefined;
  }
}

export function saveConnection(connection: Connection): void {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ url: connection.url, token: connection.token }),
  );
}

export function forgetConnection(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * A `/pair#host=<url>&token=<token>` link. The fragment never leaves the
 * browser, and it leaves the address bar and history as soon as it is read.
 */
export function readPairingRequest(url: URL): Connection | undefined {
  if (url.pathname !== "/pair") return undefined;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const host = fragment.get("host");
  const token = fragment.get("token");
  history.replaceState(null, "", "/");

  if (host === null || token === null) return undefined;

  try {
    return parseConnection({ url: host, token });
  } catch {
    return undefined;
  }
}
