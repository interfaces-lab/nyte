/**
 * Host identities this browser pinned, by route: an address entered by hand
 * or opened from a pairing link, or an account environment. A route pins the
 * identity its host proved by signing on first pairing, and every later
 * connect must prove that same key. A pin outlives the saved token, device
 * enrollments, tabs and sign-outs; only an explicit re-pair replaces it.
 */
import type { HostId } from "@nyte-ai/sdk";
import { idSchema } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import type { ConnectOptions, Connection, WebBridge } from "./bridge.ts";

const HostIdSchema = idSchema<"host">();

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

function readPin(storage: PinStorage, route: PinRoute): HostId | undefined {
  try {
    const text = storage.getItem(keyOf(route));
    const value: unknown = text === null ? undefined : JSON.parse(text);

    return Value.Check(HostIdSchema, value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Connect as the route's pinned host. Unpinned, or when the owner chose to
 * `repair`, the host that answers becomes the pin. A host that cannot prove
 * the pin rejects with `SdkError` `stale` and the pin stays.
 */
export async function connectPinned(input: {
  readonly bridge: Pick<WebBridge, "connect">;
  readonly storage: PinStorage;
  readonly route: PinRoute;
  readonly connection: Connection;
  readonly repair: boolean;
  readonly options?: Omit<ConnectOptions, "expect">;
}): Promise<HostId> {
  const pinned = input.repair ? undefined : readPin(input.storage, input.route);
  const hostId = await input.bridge.connect(input.connection, {
    ...input.options,
    ...(pinned === undefined ? {} : { expect: pinned }),
  });

  if (pinned === undefined) input.storage.setItem(keyOf(input.route), JSON.stringify(hostId));

  return hostId;
}
