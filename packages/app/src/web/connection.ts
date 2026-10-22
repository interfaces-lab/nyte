import { Type } from "typebox";
import { Value } from "typebox/value";
import { errorMessage } from "../errors.ts";
import type { Connection } from "./bridge.ts";

const STORAGE_KEY = "nyte:connection";

const ConnectionSchema = Type.Object(
  {
    url: Type.String({ minLength: 1 }),
    token: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export function parseConnection(value: Connection): Connection {
  const token = value.token.trim();

  if (!token || value.url.trim() === "") throw new Error("Enter the address and the token.");
  let url: URL;

  try {
    url = new URL(value.url.trim());
  } catch {
    throw new Error("Enter the full address, starting with https://.");
  }

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/u.test(url.hostname);

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error("Use the HTTPS address Nyte shows on your computer.");
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

export type PairingRequest =
  | { readonly kind: "valid"; readonly connection: Connection }
  | { readonly kind: "invalid"; readonly connection: Connection; readonly message: string };

export function readPairingRequest(url: URL): PairingRequest | undefined {
  if (url.pathname !== "/pair") return undefined;
  const fragment = new URLSearchParams(url.hash.slice(1));
  const host = fragment.get("host");
  const token = fragment.get("token");
  history.replaceState(null, "", "/");

  if (host === null || token === null) return undefined;
  const connection = { url: host, token };

  try {
    return { kind: "valid", connection: parseConnection(connection) };
  } catch (cause) {
    return { kind: "invalid", connection, message: errorMessage(cause) };
  }
}
