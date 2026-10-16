import type { Cursor, HostId, SessionId } from "./ids.ts";

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };
export type JsonSchema = { readonly [key: string]: Json };
export type Disposer = () => void;
export type Owned = { close(): Promise<void>; [Symbol.asyncDispose](): Promise<void> };
export type RequestOptions = { readonly signal?: AbortSignal };
export type Paged<T> = { readonly items: readonly T[]; readonly next: Cursor | null };
export type ParentFilter =
  | { readonly kind: "all" }
  | { readonly kind: "roots" }
  | { readonly kind: "children"; readonly session: SessionId };
export type Capability<T> =
  | { readonly kind: "available"; readonly api: T }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly retry: "allowed" | "manual"; readonly reason: string };
export type ByteReader = Owned & {
  readonly size: number | null;
  readonly mime: string | null;
  chunks(): AsyncIterable<Uint8Array>;
};
export type IdentityChallenge = {
  readonly hostId: HostId;
  readonly nonce: string;
  readonly signature: string;
  readonly publicKey: string;
};
export type HostDescription = {
  readonly name: string;
  readonly platform: string;
  readonly version: string;
};

export type Awaitable<T> = T | Promise<T>;
