/**
 * Host ids this phone pinned, by route: an address entered by hand or
 * scanned, or an account environment. A route pins the id its host answered
 * on first pairing, and every later connect, resume included, must answer the
 * same one. The id is not signed: the sdk's `expect` check needs WebCrypto
 * Ed25519, which Hermes lacks. A pin outlives the saved token, device
 * enrollments, disconnects and sign-outs; only an explicit re-pair replaces it.
 */
import { base64ToBase64Url } from "@nyte-ai/connect";
import type { DeviceCrypto } from "@nyte-ai/connect/enrollment";
import type { HostId } from "@nyte-ai/sdk";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { SavedConnection } from "./connection.ts";

export type PinRoute =
  | { readonly kind: "address"; readonly url: string }
  /** The broker, the owner the environment is linked under, and the environment. Never the device. */
  | {
      readonly kind: "account";
      readonly origin: string;
      readonly ownerId: string;
      readonly environmentId: string;
    };

export function routeOf(saved: SavedConnection): PinRoute {
  return saved.kind === "manual"
    ? { kind: "address", url: saved.connection.url }
    : {
        kind: "account",
        origin: saved.binding.origin,
        ownerId: saved.binding.ownerId,
        environmentId: saved.binding.environmentId,
      };
}

/** Keychain items: one per route, apart from the saved connection. */
export interface PinStorage {
  readonly read: (key: string) => Promise<string | null>;
  readonly write: (key: string, text: string) => Promise<void>;
}

export interface PinStore {
  /** Undefined when the route never pinned. Unreadable or malformed storage throws. */
  readonly read: (route: PinRoute) => Promise<string | undefined>;
  readonly write: (route: PinRoute, hostId: HostId) => Promise<void>;
}

const PinSchema = Type.Object({ hostId: Type.String({ minLength: 1 }) });

export function createPinStore(storage: PinStorage, crypto: DeviceCrypto): PinStore {
  // Keychain keys allow only letters, digits, `.`, `-` and `_`.
  const keyOf = async (route: PinRoute) => {
    const parts =
      route.kind === "address"
        ? [route.kind, route.url]
        : [route.kind, route.origin, route.ownerId, route.environmentId];

    return `nyte.pin.${base64ToBase64Url(await crypto.sha256Base64(JSON.stringify(parts)))}`;
  };

  return {
    async read(route) {
      const text = await storage.read(await keyOf(route));

      if (text === null) return undefined;
      const value: unknown = JSON.parse(text);

      if (!Value.Check(PinSchema, value)) throw new Error("The saved host pin is unreadable.");

      return value.hostId;
    },
    write: async (route, hostId) => storage.write(await keyOf(route), JSON.stringify({ hostId })),
  };
}
