/**
 * Account remote access as a settings surface shows it: no machine key, no
 * session JWT, no device token. Owned by the Connect lifecycle, below any UI;
 * the desktop bridge and a headless status command read the same shape.
 */
/** Why account remote access cannot run in this build or on this Mac. */
export type ConnectUnavailable =
  /** The build carries no usable broker origin or Clerk keys. */
  | "not_configured"
  /** `~/.nyte/connect.json` cannot be used; nothing is accepted. */
  | "store_failed"
  /** The stored link was made with another broker than this build names; it is neither served nor reinterpreted. */
  | "origin_changed";

/** The Clerk session on this desktop. Display only; never a credential. */
export type ConnectAccount =
  | { readonly kind: "unavailable" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "signed_in"; readonly label: string };

export type ConnectLinkFailure =
  | "cancelled"
  | "network"
  | "limit"
  | "owner_disabled"
  | "session_revoked"
  /** The owner refused the transaction, or let it lapse. */
  | "denied"
  | "expired"
  | "refused";

export type ConnectLinking =
  | { readonly kind: "idle" }
  /** The sign-in dialog is open and the user has not finished signing in. */
  | { readonly kind: "waiting_for_account" }
  /**
   * A headless host's transaction is open: the owner signs in at `verifyUrl`
   * on another device, enters `userCode`, and compares `fingerprint` with
   * what the host shows before approving.
   */
  | {
      readonly kind: "awaiting_approval";
      readonly verifyUrl: string;
      readonly userCode: string;
      readonly fingerprint: string;
      readonly expiresAt: number;
    }
  /** The broker is registering this Mac. */
  | { readonly kind: "linking" }
  | { readonly kind: "failed"; readonly reason: ConnectLinkFailure };

/**
 * Whether account devices may use the listener right now. Only `current`
 * admits them; every other state refuses them and has closed their streams.
 */
export type ConnectLease =
  | { readonly kind: "stopped" }
  /** Serving, and no lease verified since start or wake. */
  | { readonly kind: "pending" }
  | { readonly kind: "current"; readonly expiresAt: number }
  | { readonly kind: "lapsed"; readonly reason: "offline" | "owner_disabled" };

/**
 * This Mac's WebSocket to the broker's relay. Only `connected` carries phone
 * requests; it means the relay accepted this Mac's signed proof.
 */
export type ConnectRelay =
  | { readonly kind: "stopped" }
  | { readonly kind: "connecting" }
  | { readonly kind: "connected" }
  /** The socket closed or was refused; the next attempt waits a jittered backoff. */
  | { readonly kind: "retrying"; readonly attempt: number }
  /** Another Nyte instance took over this Mac's link. Nothing reconnects until the user turns it on again. */
  | { readonly kind: "failed"; readonly reason: "replaced" };

/** A phone enrolled through the account. Only a digest of its token is kept. */
export interface ConnectDevice {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  /** Listed by the current lease. */
  readonly authorized: boolean;
}

/** Why the Mac is unlinked, when that was not the user's own doing just now. */
export type ConnectNotice =
  | { readonly kind: "none" }
  /** The broker reported the environment removed, from a phone or by the operator. */
  | { readonly kind: "revoked" }
  /** Unlinked here; the broker has not confirmed yet and is retried. */
  | { readonly kind: "unlink_pending" };

/**
 * Account remote access as Settings shows it: no machine key, session JWT, or
 * device token. Changes arrive as `remote_access_changed`.
 */
export type ConnectView =
  | { readonly kind: "unavailable"; readonly reason: ConnectUnavailable }
  | {
      readonly kind: "unlinked";
      readonly account: ConnectAccount;
      readonly linking: ConnectLinking;
      readonly notice: ConnectNotice;
    }
  | {
      readonly kind: "linked";
      readonly account: ConnectAccount;
      /** The Clerk user the link belongs to, which may differ from the signed-in one. */
      readonly owner: { readonly id: string; readonly label: string };
      readonly environment: {
        readonly id: string;
        readonly name: string;
        /** `<origin>/r/<id>`, where phones reach this Mac through the relay. */
        readonly address: string;
      };
      /** Persisted; off by default. On means serve whenever Nyte runs, after a lease verifies. */
      readonly enabled: boolean;
      readonly connection: ConnectRelay;
      readonly lease: ConnectLease;
      readonly devices: readonly ConnectDevice[];
    };
