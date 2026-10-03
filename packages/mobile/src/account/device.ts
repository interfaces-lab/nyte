import {
  CryptoDigestAlgorithm,
  CryptoEncoding,
  digestStringAsync,
  getRandomBytesAsync,
} from "expo-crypto";
import { deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";
import { base64Url, ClientId } from "@nyte-ai/connect";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DeviceCrypto } from "./enrollment.ts";

const CLIENT_KEY = "nyte.account.client";

/** The name a Mac lists this device under. */
export const CLIENT_NAME = "iPhone";

/**
 * `getRandomBytesAsync` always reads the native generator. The synchronous
 * `getRandomBytes` falls back to `Math.random` under a remote debugger.
 */
export const deviceCrypto: DeviceCrypto = {
  randomBytes: getRandomBytesAsync,
  sha256Base64: (text) =>
    digestStringAsync(CryptoDigestAlgorithm.SHA256, text, { encoding: CryptoEncoding.BASE64 }),
};

const StoredClient = Type.Object(
  { ownerId: Type.String({ minLength: 1 }), clientId: ClientId },
  { additionalProperties: false },
);

function parseStoredClient(text: string | null): unknown {
  if (text === null) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * This install's id toward one account. The broker replaces an earlier device
 * with the same id, so reconnecting does not pile up devices. Another account
 * gets a new id, so the broker cannot link the two.
 */
export async function readClientId(ownerId: string): Promise<string> {
  const stored = parseStoredClient(await getItemAsync(CLIENT_KEY));

  if (Value.Check(StoredClient, stored) && stored.ownerId === ownerId) return stored.clientId;
  const clientId = base64Url(await getRandomBytesAsync(16));
  await setItemAsync(CLIENT_KEY, JSON.stringify({ ownerId, clientId }));

  return clientId;
}

export const forgetClientId = () => deleteItemAsync(CLIENT_KEY);
