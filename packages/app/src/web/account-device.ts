import {
  base64Url,
  ClientId,
  DeviceRole,
  DeviceToken,
  Name,
  relayAddress,
  Uuid,
} from "@nyte-ai/connect";
import type { AccountConfig } from "@nyte-ai/connect/account-config";
import type { DeviceCrypto } from "@nyte-ai/connect/enrollment";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

const DEVICE_KEY = "nyte:account:device";

const CLIENT_KEY = "nyte:account:client";

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const AccountDevice = Type.Object(
  {
    origin: Type.String(),
    ownerId: Type.String({ minLength: 1 }),
    environmentId: Uuid,
    deviceId: Uuid,
    name: Name,
    token: DeviceToken,
    /** What this browser enrolled as; the host grants `owner` only with its operator's consent. */
    role: DeviceRole,
  },
  { additionalProperties: false },
);

export type AccountDevice = Static<typeof AccountDevice>;

const StoredClient = Type.Object(
  { ownerId: Type.String({ minLength: 1 }), clientId: ClientId },
  { additionalProperties: false },
);

function readStored<T extends TSchema>(
  storage: SessionStorage,
  key: string,
  schema: T,
): Static<T> | undefined {
  try {
    const text = storage.getItem(key);

    const value: unknown = text === null ? undefined : JSON.parse(text);

    return Value.Check(schema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function readAccountDevice(
  storage: SessionStorage,
  config: AccountConfig,
): AccountDevice | undefined {
  const device = readStored(storage, DEVICE_KEY, AccountDevice);

  return device?.origin === config.origin ? device : undefined;
}

export function loadAccountDevice(
  storage: SessionStorage,
  config: AccountConfig,
  ownerId: string,
): AccountDevice | undefined {
  const device = readAccountDevice(storage, config);

  return device?.ownerId === ownerId ? device : undefined;
}

export function saveAccountDevice(storage: SessionStorage, device: AccountDevice): void {
  storage.setItem(DEVICE_KEY, JSON.stringify(device));
}

export function forgetAccountDevice(storage: SessionStorage): void {
  storage.removeItem(DEVICE_KEY);
}

export function forgetClientId(storage: SessionStorage): void {
  storage.removeItem(CLIENT_KEY);
}

export function readClientId(storage: SessionStorage, ownerId: string): string {
  const stored = readStored(storage, CLIENT_KEY, StoredClient);

  if (stored !== undefined && stored.ownerId === ownerId) return stored.clientId;
  const clientId = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  storage.setItem(CLIENT_KEY, JSON.stringify({ ownerId, clientId }));

  return clientId;
}

export function accountConnection(device: AccountDevice) {
  return { url: relayAddress(device.origin, device.environmentId), token: device.token };
}

export const deviceCrypto: DeviceCrypto = {
  randomBytes: async (count) => crypto.getRandomValues(new Uint8Array(count)),
  sha256Base64: async (text) => {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));

    return btoa(String.fromCharCode(...new Uint8Array(digest)));
  },
};
