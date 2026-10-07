/**
 * Host identities this browser pinned, by route: an address entered by hand
 * or opened from a pairing link, or an account environment. A route pins the
 * identity its host proved by signing on first pairing, and every later
 * connect must prove that same key. A pin outlives the saved token, device
 * enrollments, tabs and sign-outs; only an explicit re-pair replaces it.
 */
import { HostIdentitySchema } from "@nyte-ai/protocol";
import type { HostIdentity, ServerInfo } from "@nyte-ai/protocol";
import { Value } from "typebox/value";
import type { ConnectOptions, Connection, WebBridge } from "./bridge.ts";

type PinStorage = Pick<Storage, "getItem" | "setItem">;

export type PinRoute =
  | { readonly kind: "address"; readonly url: string }
  /** The broker, the owner the environment is linked under, and the environment. */
  | {
      readonly kind: "account";
      readonly origin: string;
      readonly ownerId: string;
      readonly environmentId: string;
    };

function keyOf(route: PinRoute): string {
  const parts =
    route.kind === "address"
      ? [route.kind, route.url]
      : [route.kind, route.origin, route.ownerId, route.environmentId];

  return `nyte:host-identity:${JSON.stringify(parts)}`;
}

function readPin(storage: PinStorage, route: PinRoute): HostIdentity | undefined {
  try {
    const text = storage.getItem(keyOf(route));
    const value: unknown = text === null ? undefined : JSON.parse(text);

    return Value.Check(HostIdentitySchema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Connect as the route's pinned host. Unpinned, or when the owner chose to
 * `repair`, the bridge makes the host sign for the identity it announces
 * before adopting it, and that proven identity becomes the pin. A host that
 * cannot prove the pin rejects with `IdentityChanged` and the pin stays.
 */
export async function connectPinned(input: {
  readonly bridge: Pick<WebBridge, "connect">;
  readonly storage: PinStorage;
  readonly route: PinRoute;
  readonly connection: Connection;
  readonly repair: boolean;
  readonly options?: Omit<ConnectOptions, "identity">;
}): Promise<ServerInfo> {
  const pinned = input.repair ? undefined : readPin(input.storage, input.route);
  const info = await input.bridge.connect(input.connection, { ...input.options, identity: pinned });

  if (pinned === undefined && info.identity !== undefined)
    input.storage.setItem(keyOf(input.route), JSON.stringify(info.identity));

  return info;
}
