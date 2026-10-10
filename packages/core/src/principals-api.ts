import type { Authority, Disposer, Json, PrincipalId } from "@nyte-ai/schema";
import type { Host } from "./host.ts";
import type { Kernel } from "./kernel.ts";

/** Returns what `host/principals` holds, as an envelope of kind `principals`: every paired principal with its authority, when it paired and was last seen, and `tokenDigest`, the SHA-256 hex digest of its device token (the token itself is never stored); and the pairing codes not yet redeemed, each with the authority and label it grants and when it expires. */
export type PrincipalRecord = {
  readonly principals: readonly {
    readonly id: PrincipalId;
    readonly label: string;
    readonly authority: readonly Authority[];
    readonly pairedAt: number;
    readonly lastSeenAt: number | null;
    readonly tokenDigest: string;
  }[];
  readonly codes: readonly {
    readonly code: string;
    readonly authority: readonly Authority[];
    readonly label: string;
    readonly expiresAt: number;
  }[];
};

/** Holds the open connections of each principal in this process, so revoking one drops its streams; what the host's listener registers every authenticated connection with. One per kernel (`kernel.connections`), built on first use. */
export interface ConnectionRegistry {
  /** Records a principal's connection and how to close it; the disposer forgets it (the connection closed on its own). */
  register(principal: PrincipalId, close: () => void): Disposer;
  /** Closes and forgets every connection the principal registered; accepted work continues. */
  revoke(principal: PrincipalId): void;
}

/** Returns the principal record a stored object holds, or null when it holds another record. */
export function decodePrincipalRecord(object: Json | null): PrincipalRecord | null {
  throw new Error("not implemented");
}

/** Returns `Host.principals` over `host/principals` (absent reads as no principals and no codes; each write compare-and-sets the ref and retries once on a lost race). `list` returns every paired principal as a `PrincipalView`. `pair` mints a random code that expires in ten minutes, granting `authority` under `label` (default "Paired device"), and drops expired codes. `revoke` removes the principal from the record and calls `kernel.connections.revoke`; an unknown id resolves without writing. What `kernel.principals` holds. */
export function createPrincipals(kernel: Kernel): Host["principals"] {
  throw new Error("not implemented");
}

/** Redeems a pairing code once, as the host's listener does for a `{ kind: "pairing" }` credential: an unexpired code is removed and a principal with a fresh id (never `local` or `token`, decision 4), the code's label and authority, `pairedAt` now and a fresh device token, stored as its digest, is added in the same write; resolves the principal, its authority and the token the device keeps (`Connection.credential`, decision 11). Null for an unknown or expired code. */
export function redeemPairing(
  kernel: Kernel,
  code: string,
): Promise<{
  readonly principal: PrincipalId;
  readonly authority: ReadonlySet<Authority>;
  readonly token: string;
} | null> {
  throw new Error("not implemented");
}

/** Resolves the paired principal a device token names, comparing its SHA-256 digest with each stored one, and records `lastSeenAt`; null when no principal holds it. What the host's listener calls for a `{ kind: "token" }` credential that is not the host's own token. */
export function authenticateToken(
  kernel: Kernel,
  token: string,
): Promise<{ readonly principal: PrincipalId; readonly authority: ReadonlySet<Authority> } | null> {
  throw new Error("not implemented");
}

/** Returns an empty connection registry: what `kernel.connections` holds. */
export function createConnectionRegistry(): ConnectionRegistry {
  throw new Error("not implemented");
}
