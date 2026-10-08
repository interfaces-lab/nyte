/**
 * Host identities this phone pinned, by route: an address entered by hand or
 * scanned, or an account environment. A route pins the identity its host
 * proved by signing on first pairing, and every later connect, resume
 * included, must prove that same key. A pin outlives the saved token, device
 * enrollments, disconnects and sign-outs; only an explicit re-pair replaces it.
 */
import { base64ToBase64Url } from "@nyte-ai/connect";
import type { DeviceCrypto } from "@nyte-ai/connect/enrollment";
import { HostIdentitySchema } from "@nyte-ai/protocol";
import type { HostIdentity } from "@nyte-ai/protocol";
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
  readonly read: (route: PinRoute) => Promise<HostIdentity | undefined>;
  readonly write: (route: PinRoute, identity: HostIdentity) => Promise<void>;
}

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

      if (!Value.Check(HostIdentitySchema, value))
        throw new Error("The saved host pin is unreadable.");

      return value;
    },
    write: async (route, identity) =>
      storage.write(
        await keyOf(route),
        JSON.stringify({ hostId: identity.hostId, publicKey: identity.publicKey }),
      ),
  };
}
