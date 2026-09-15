import { createNyteClient, NyteTransportError, NyteWireError, type NyteClient } from "@nyte-ai/client";
import { fetch } from "expo/fetch";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
import { displayAddress, parseConnection, type Connection } from "./connection.ts";
import { classifyConnectFailure, type ConnectFailure } from "./connect-copy.ts";

const STORAGE_KEY = "nyte.host";

export function createHostClient(connection: Connection): NyteClient {
  return createNyteClient({ baseUrl: connection.url, token: connection.token, fetch });
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
  if (signal.aborted) return { kind: "cancelled" };
  try {
    await setItemAsync(STORAGE_KEY, JSON.stringify(connection));
  } catch {
    return { kind: "notSaved" };
  }
  if (signal.aborted) {
    await forgetConnection();
    return { kind: "cancelled" };
  }
  return { kind: "connected" };
}

export async function readConnection(): Promise<Connection | undefined> {
  const saved = await getItemAsync(STORAGE_KEY);
  if (saved === null) return undefined;
  const parsed: unknown = JSON.parse(saved);
  return parseConnection(parsed);
}

export const forgetConnection = () => deleteItemAsync(STORAGE_KEY);
