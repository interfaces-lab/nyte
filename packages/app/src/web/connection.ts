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

function allowsPlainHttp(hostname: string): boolean {
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

  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowsPlainHttp(url.hostname))) {
    throw new Error("Use HTTPS, or HTTP with your Mac's local or Tailscale address.");
  }

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/u.test(url.hostname);

  if (url.protocol === "http:" && location.protocol === "https:" && !loopback) {
    throw new Error(
      "This page is served over HTTPS, so it needs an HTTPS address, such as one from Tailscale HTTPS.",
    );
  }

  if (url.username || url.password || url.search || url.hash)
    throw new Error("Enter only the address. The token has its own field.");

  return { url: url.href.replace(/\/$/, ""), token };
}

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
