import { base64ToBase64Url } from "@nyte-ai/connect";
import type { DeviceCrypto } from "@nyte-ai/connect/enrollment";
import type { HostId } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { SavedConnection } from "./connection.ts";

export type PinRoute =
  | { readonly kind: "address"; readonly url: string }
  | {
      readonly kind: "account";
      readonly origin: string;
      readonly ownerId: string;
      readonly environmentId: string;
    };

export function pinRoute(saved: SavedConnection): PinRoute {
  return saved.kind === "manual"
    ? { kind: "address", url: saved.connection.url }
    : {
        kind: "account",
        origin: saved.binding.origin,
        ownerId: saved.binding.ownerId,
        environmentId: saved.binding.environmentId,
      };
}

export interface PinStorage {
  readonly read: (key: string) => Promise<string | null>;
  readonly write: (key: string, text: string) => Promise<void>;
}

export interface PinStore {
  readonly read: (route: PinRoute) => Promise<string | undefined>;
  readonly write: (route: PinRoute, hostId: HostId) => Promise<void>;
}

const PinSchema = Type.Object({ hostId: Type.String({ minLength: 1 }) });

/** The Keychain key for a route's pin, hashed because Keychain keys allow only letters, digits, `.`, `-` and `_`. */
async function pinKey(crypto: DeviceCrypto, route: PinRoute): Promise<string> {
  const parts =
    route.kind === "address"
      ? [route.kind, route.url]
      : [route.kind, route.origin, route.ownerId, route.environmentId];

  return `nyte.pin.${base64ToBase64Url(await crypto.sha256Base64(JSON.stringify(parts)))}`;
}

export function createPinStore(storage: PinStorage, crypto: DeviceCrypto): PinStore {
  return {
    async read(route) {
      const text = await storage.read(await pinKey(crypto, route));

      if (text === null) return undefined;
      const value: unknown = JSON.parse(text);

      if (!Value.Check(PinSchema, value)) throw new Error("The saved host pin is unreadable.");

      return value.hostId;
    },
    write: async (route, hostId) =>
      storage.write(await pinKey(crypto, route), JSON.stringify({ hostId })),
  };
}
