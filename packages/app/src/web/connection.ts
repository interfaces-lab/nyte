import { Type } from "typebox";
import { localArea, readStored, removeStored, writeStored } from "../lib/storage.ts";
import type { Connection } from "./bridge.ts";

const STORAGE_KEY = "nyte:connection";

const ConnectionSchema = Type.Object(
  {
    url: Type.String({ minLength: 1 }),
    token: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

type CheckedConnection =
  | { readonly kind: "valid"; readonly connection: Connection }
  | { readonly kind: "invalid"; readonly message: string };

export function parseConnection(value: Connection): Connection {
  const checked = checkConnection(value);

  if (checked.kind === "invalid") throw new Error(checked.message);

  return checked.connection;
}

/** The connection as Nyte dials it, or what is wrong with it. */
function checkConnection(value: Connection): CheckedConnection {
  const token = value.token.trim();

  if (!token || value.url.trim() === "") return invalid("Enter the address and the token.");
  const url = URL.parse(value.url.trim());

  if (url === null) return invalid("Enter the full address, starting with https://.");

  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(\.\d{1,3}){3}$/u.test(url.hostname);

  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    return invalid("Use the HTTPS address Nyte shows on your computer.");

  if (url.username || url.password || url.search || url.hash)
    return invalid("Enter only the address. The token has its own field.");

  return { kind: "valid", connection: { url: url.href.replace(/\/$/, ""), token } };
}

function invalid(message: string): CheckedConnection {
  return { kind: "invalid", message };
}

export function displayAddress(connection: Connection): string {
  return new URL(connection.url).host;
}

export function loadConnection(): Connection | undefined {
  const stored = readStored(localArea(), STORAGE_KEY, ConnectionSchema, undefined);
  const checked = stored === undefined ? undefined : checkConnection(stored);

  return checked?.kind === "valid" ? checked.connection : undefined;
}

export function saveConnection(connection: Connection): void {
  writeStored(localArea(), STORAGE_KEY, { url: connection.url, token: connection.token });
}

export function forgetConnection(): void {
  removeStored(localArea(), STORAGE_KEY);
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

  const checked = checkConnection(connection);

  return checked.kind === "valid" ? checked : { ...checked, connection };
}
