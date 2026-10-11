import type { Cursor, HostId, SessionId } from "./ids.ts";

/** Returns any JSON value. */
export type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
/** Returns a JSON Schema document. */
export type JsonSchema = { readonly [key: string]: Json };
/** Removes what it was returned for. */
export type Disposer = () => void;
/** Holds a resource until it is closed. */
export type Owned = { close(): Promise<void>; [Symbol.asyncDispose](): Promise<void> }
/** Describes how a wait may be aborted. */
export type RequestOptions = { readonly signal?: AbortSignal }
/** Returns one page of items and the cursor to the next. */
export type Paged<T> = { readonly items: readonly T[]; readonly next: Cursor | null }
/** Names which sessions a directory read returns: all, roots, or one session's children. */
export type ParentFilter = { readonly kind: "all" } | { readonly kind: "roots" } | { readonly kind: "children"; readonly session: SessionId };
/** Returns a capability's provision: available with its api, or why not. */
export type Capability<T> =
  | { readonly kind: "available"; readonly api: T }
  | { readonly kind: "unsupported"; readonly reason: string }
  | { readonly kind: "denied"; readonly reason: string }
  | { readonly kind: "unavailable"; readonly retry: "allowed" | "manual"; readonly reason: string };
/** Returns an owned byte stream with its size and mime when known. */
export type ByteReader = Owned & { readonly size: number | null; readonly mime: string | null; chunks(): AsyncIterable<Uint8Array> }
/** Returns a host's signature over a nonce, so a client can pin it: the host's id, the nonce, the Ed25519 signature over `nyte/identity\n<hostId>\n<nonce>` and the public key, both base64url (§43a, §43k). */
export type IdentityChallenge = { readonly hostId: HostId; readonly nonce: string; readonly signature: string; readonly publicKey: string }
/** Returns what a listener advertises about its host. */
export type HostDescription = { readonly name: string; readonly platform: string; readonly version: string }

/**
 * Returns `T` or a promise of `T`.
 *
 * @category schemas
 * @since 0.1.0
 */
export type Awaitable<T> = T | Promise<T>;
