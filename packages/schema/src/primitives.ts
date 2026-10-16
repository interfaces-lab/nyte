import { Type } from "typebox";
import type { TSchema } from "typebox";
import { idSchema } from "./ids.ts";
import type { Cursor } from "./ids.ts";
import { withJson } from "./json.ts";
import { standard } from "./schema.ts";
import type { Decoded, Schema } from "./schema.ts";
import { nullable } from "./wire/nullable.ts";

export function pagedSchema<T extends TSchema>(item: T) {
  return standard(
    withJson(Type.Object({ items: Type.Array(item), next: nullable(idSchema<"cursor">()) })),
  );
}

export const ParentFilterType = Type.Union([
  Type.Object({ kind: Type.Literal("all") }),
  Type.Object({ kind: Type.Literal("roots") }),
  Type.Object({ kind: Type.Literal("children"), session: idSchema<"session">() }),
]);

export type ParentFilter = Decoded<typeof ParentFilterType>;

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

export type CapabilityWire = Decoded<typeof CapabilityWireType>;

export const IdentityChallengeType = Type.Object({
  hostId: idSchema<"host">(),
  nonce: Type.String(),
  signature: Type.String(),
  publicKey: Type.String(),
});

export type IdentityChallenge = Decoded<typeof IdentityChallengeType>;

export const HostDescriptionType = Type.Object({
  name: Type.String(),
  platform: Type.String(),
  version: Type.String(),
});

export type HostDescription = Decoded<typeof HostDescriptionType>;

export const ParentFilterSchema: Schema<ParentFilter> = standard(ParentFilterType);

export const CapabilityWireSchema: Schema<CapabilityWire> = standard(CapabilityWireType);

export const IdentityChallengeSchema: Schema<IdentityChallenge> = standard(IdentityChallengeType);

export const HostDescriptionSchema: Schema<HostDescription> = standard(HostDescriptionType);

export type Disposer = () => void;

export type Owned = { close(): Promise<void>; [Symbol.asyncDispose](): Promise<void> };

export type RequestOptions = { readonly signal?: AbortSignal };

export type Paged<T> = { readonly items: readonly T[]; readonly next: Cursor | null };

/** A capability as the client holds it: the wire's answer, with the API itself when it is available. */
export type Capability<T> =
  | Exclude<CapabilityWire, { readonly kind: "available" }>
  | { readonly kind: "available"; readonly api: T };

export type ByteReader = Owned & {
  readonly size: number | null;
  readonly mime: string | null;
  chunks(): AsyncIterable<Uint8Array>;
};

export type Awaitable<T> = T | Promise<T>;
