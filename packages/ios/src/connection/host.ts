import { createNyteClient, type NyteClient } from "@nyte-ai/client";
import { fetch } from "expo/fetch";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
import { parseConnection, type Connection } from "./connection.ts";

const STORAGE_KEY = "nyte.host";

export function createHostClient(connection: Connection): NyteClient {
  return createNyteClient({ baseUrl: connection.url, token: connection.token, fetch });
}

/**
 * One `/v1/info` round trip bound to `signal`, so a wrong address or a silent
 * host can be abandoned instead of leaving the form busy.
 */
export async function verifyHost(connection: Connection, signal: AbortSignal): Promise<void> {
  const probe = createNyteClient({
    baseUrl: connection.url,
    token: connection.token,
    fetch: (input, init) => fetch(input, { ...init, signal }),
  });
  await probe.info();
}

export async function readConnection(): Promise<Connection | undefined> {
  const saved = await getItemAsync(STORAGE_KEY);
  if (saved === null) return undefined;
  const parsed: unknown = JSON.parse(saved);
  return parseConnection(parsed);
}

export const saveConnection = (connection: Connection) =>
  setItemAsync(STORAGE_KEY, JSON.stringify(connection));
export const forgetConnection = () => deleteItemAsync(STORAGE_KEY);
