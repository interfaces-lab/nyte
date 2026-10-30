import type { HostId } from "@nyte-ai/sdk";
import { idSchema } from "@nyte-ai/schema";
import { readStored, type StorageArea, writeStored } from "../lib/storage.ts";
import type { ConnectOptions, Connection, WebBridge } from "./bridge.ts";

const HostIdSchema = idSchema<"host">();

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

export async function connectPinned(input: {
  readonly bridge: Pick<WebBridge, "connect">;
  readonly storage: StorageArea;
  readonly route: PinRoute;
  readonly connection: Connection;
  readonly repair: boolean;
  readonly options?: Omit<ConnectOptions, "expect">;
}): Promise<HostId> {
  const pinned = input.repair
    ? undefined
    : readStored(input.storage, formatPinKey(input.route), HostIdSchema, undefined);

  const hostId = await input.bridge.connect(input.connection, {
    ...input.options,
    ...(pinned === undefined ? {} : { expect: pinned }),
  });

  if (pinned === undefined) writeStored(input.storage, formatPinKey(input.route), hostId);

  return hostId;
}
