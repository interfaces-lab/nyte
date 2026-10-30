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
import type { Static } from "typebox";
import { readStored, removeStored, type StorageArea, writeStored } from "../lib/storage.ts";

const DEVICE_KEY = "nyte:account:device";

const CLIENT_KEY = "nyte:account:client";

const AccountDevice = Type.Object(
  {
    origin: Type.String(),
    ownerId: Type.String({ minLength: 1 }),
    environmentId: Uuid,
    deviceId: Uuid,
    name: Name,
    token: DeviceToken,
    role: DeviceRole,
  },
  { additionalProperties: false },
);

export type AccountDevice = Static<typeof AccountDevice>;

const StoredClient = Type.Object(
  { ownerId: Type.String({ minLength: 1 }), clientId: ClientId },
  { additionalProperties: false },
);

export function readAccountDevice(
  storage: StorageArea,
  config: AccountConfig,
): AccountDevice | undefined {
  const device = readStored(storage, DEVICE_KEY, AccountDevice, undefined);

  return device?.origin === config.origin ? device : undefined;
}

export function loadAccountDevice(
  storage: StorageArea,
  config: AccountConfig,
  ownerId: string,
): AccountDevice | undefined {
  const device = readAccountDevice(storage, config);

  return device?.ownerId === ownerId ? device : undefined;
}

export function saveAccountDevice(storage: StorageArea, device: AccountDevice): void {
  writeStored(storage, DEVICE_KEY, device);
}

export function forgetAccountDevice(storage: StorageArea): void {
  removeStored(storage, DEVICE_KEY);
}

export function forgetClientId(storage: StorageArea): void {
  removeStored(storage, CLIENT_KEY);
}

export function readClientId(storage: StorageArea, ownerId: string): string {
  const stored = readStored(storage, CLIENT_KEY, StoredClient, undefined);

  if (stored !== undefined && stored.ownerId === ownerId) return stored.clientId;
  const clientId = base64Url(crypto.getRandomValues(new Uint8Array(16)));
  writeStored(storage, CLIENT_KEY, { ownerId, clientId });

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
