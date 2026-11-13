import type { HostId } from "@nyte-ai/sdk";
import { idSchema } from "@nyte-ai/schema";
import { Type } from "typebox";
import { readStored, removeStored, type StorageArea, writeStored } from "../lib/storage.ts";
import type { ConnectOptions, Connection, WebBridge } from "./bridge.ts";

const PinSchema = Type.Object({
  hostId: idSchema<"host">(),
  publicKey: Type.String({ minLength: 1 }),
});

export type PinRoute =
  | { readonly kind: "address"; readonly url: string }
  | {
      readonly kind: "account";
      readonly origin: string;
      readonly ownerId: string;
      readonly environmentId: string;
    };

function formatPinKey(route: PinRoute): string {
  const parts =
    route.kind === "address"
      ? [route.kind, route.url]
      : [route.kind, route.origin, route.ownerId, route.environmentId];

  return `nyte:host-identity:${JSON.stringify(parts)}`;
}

/** Connects to a route and holds it to the host id and identity key it proved the first time, or since a repair. A first connection or a repair saves what the host proved, and removes the pin when it proved no key, so a host without an identity key is connected unpinned. */
export async function connectPinned(input: {
  readonly bridge: Pick<WebBridge, "connect">;
  readonly storage: StorageArea;
  readonly route: PinRoute;
  readonly connection: Connection;
  readonly repair: boolean;
  readonly options?: Omit<ConnectOptions, "expect">;
}): Promise<HostId> {
  const key = formatPinKey(input.route);
  const pinned = input.repair ? undefined : readStored(input.storage, key, PinSchema, undefined);

  const answered = await input.bridge.connect(input.connection, {
    ...input.options,
    expect: pinned,
  });

  if (pinned !== undefined) return answered.hostId;

  if (answered.publicKey === undefined) removeStored(input.storage, key);
  else writeStored(input.storage, key, { hostId: answered.hostId, publicKey: answered.publicKey });

  return answered.hostId;
}
