import { Type } from "typebox";
import type { TSchema } from "typebox";
import type {
  Capability,
  HostDescription,
  IdentityChallenge,
  ParentFilter,
} from "../primitives.ts";
import { standard } from "../schema.ts";
import type { Schema } from "../schema.ts";
import { idSchema } from "./ids.ts";
import { withJson } from "./json.ts";
import { nullable } from "./nullable.ts";

/** Returns the wire form of a `Capability`: its kind and why not; the sdk binds the api for `available`. */
export type CapabilityWire =
  | Exclude<Capability<null>, { readonly kind: "available" }>
  | { readonly kind: "available" };

/** Returns the schema of a `Paged` list of `item`. */
export function pagedSchema<T extends TSchema>(item: T) {
  return standard(
    withJson(Type.Object({ items: Type.Array(item), next: nullable(idSchema<"cursor">()) })),
  );
}

/** The TypeBox schema of a `ParentFilter`. */
export const ParentFilterType = Type.Union([
  Type.Object({ kind: Type.Literal("all") }),
  Type.Object({ kind: Type.Literal("roots") }),
  Type.Object({ kind: Type.Literal("children"), session: idSchema<"session">() }),
]);

/** The TypeBox schema of a `CapabilityWire`. */
export const CapabilityWireType = Type.Union([
  Type.Object({ kind: Type.Literal("available") }),
  Type.Object({ kind: Type.Literal("unsupported"), reason: Type.String() }),
  Type.Object({ kind: Type.Literal("denied"), reason: Type.String() }),
  Type.Object({
    kind: Type.Literal("unavailable"),
    retry: Type.Enum(["allowed", "manual"]),
    reason: Type.String(),
  }),
]);

/** The TypeBox schema of an `IdentityChallenge`. */
export const IdentityChallengeType = Type.Object({
  hostId: idSchema<"host">(),
  nonce: Type.String(),
  signature: Type.String(),
  publicKey: Type.String(),
});

/** The TypeBox schema of a `HostDescription`. */
export const HostDescriptionType = Type.Object({
  name: Type.String(),
  platform: Type.String(),
  version: Type.String(),
});

/** Validates a `ParentFilter`. */
export const ParentFilterSchema: Schema<ParentFilter> = standard(ParentFilterType);

/** Validates a `CapabilityWire`. */
export const CapabilityWireSchema: Schema<CapabilityWire> = standard(CapabilityWireType);

/** Validates an `IdentityChallenge`. */
export const IdentityChallengeSchema: Schema<IdentityChallenge> = standard(IdentityChallengeType);

/** Validates a `HostDescription`. */
export const HostDescriptionSchema: Schema<HostDescription> = standard(HostDescriptionType);
