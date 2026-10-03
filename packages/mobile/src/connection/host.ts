import {
  createNyteClient,
  NyteTransportError,
  NyteWireError,
  type NyteClient,
} from "@nyte-ai/client";
import { fetch } from "expo/fetch";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
import { displayAddress, type Connection, type SavedConnection } from "./connection.ts";
import { classifyConnectFailure, type ConnectFailure } from "./connect-copy.ts";
import { createConnectionStore } from "./connection-store.ts";
import { readAccountConfig } from "../account/account-config.ts";
import { releaseReplaced } from "../account/revocation.ts";

const STORAGE_KEY = "nyte.host";

export const connectionStore = createConnectionStore(
  {
    read: () => getItemAsync(STORAGE_KEY),
    write: (text) => setItemAsync(STORAGE_KEY, text),
    remove: () => deleteItemAsync(STORAGE_KEY),
  },
  readAccountConfig(),
);

/**
 * An account connection shares its origin with the broker, so it sends no
 * cookies. An address-and-token connection keeps the platform default.
 */
export function createHostClient(saved: SavedConnection): NyteClient {
  const { url, token } = saved.connection;

  return createNyteClient({
    baseUrl: url,
    token,
    fetch:
      saved.kind === "managed"
        ? (input, init) => fetch(input, { ...init, credentials: "omit" })
        : fetch,
  });
}

/** How one attempt ended. Only `connected` may open a session. */
export type ConnectResult = { readonly kind: "connected" } | ConnectFailure;

/**
 * One `/v1/info` round trip bound to `signal`, then the Keychain write. The
 * ending comes back as a value, and this is the only place a client error is
 * read, so nothing downstream holds an `unknown` it could flatten into "No
 * answer".
 */
export async function connectHost(
  connection: Connection,
  signal: AbortSignal,
): Promise<ConnectResult> {
  const probe = createNyteClient({
    baseUrl: connection.url,
    token: connection.token,
    fetch: (input, init) => fetch(input, { ...init, signal }),
  });

  try {
    await probe.info();
  } catch (cause) {
    if (signal.aborted) return { kind: "cancelled" };

    if (cause instanceof NyteWireError || cause instanceof NyteTransportError)
      return classifyConnectFailure(cause, displayAddress(connection));

    // The client raises only those two, so anything else is a bug in this app.
    // Admitting that beats describing a Mac that was never asked.
    return { kind: "unexpected", detail: cause instanceof Error ? cause.message : String(cause) };
  }

  const next: SavedConnection = { kind: "manual", connection };
  const saved = await connectionStore.save(next, signal);

  if (saved.kind === "failed") return { kind: "notSaved" };

  if (saved.kind === "cancelled") return { kind: "cancelled" };
  releaseReplaced({ replaced: saved.replaced, next, fetch });

  return { kind: "connected" };
}
