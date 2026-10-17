/**
 * The Nyte account as the Connect lifecycle sees it: something that can hand
 * over one fresh Clerk session JWT for a single interactive broker call. The
 * desktop implements it over its sign-in renderer; the credential is sent once
 * and never kept here.
 *
 * The account session and the machine link have separate lifetimes. Signing out
 * leaves the link and remote access as they are; background work such as the
 * lease heartbeat signs with the machine key and never asks for a session token.
 */
export interface AccountSession {
  /**
   * Show the sign-in dialog if needed, and
   * resolve with one fresh Clerk session JWT for a single interactive broker call.
   * The caller sends it once and never stores it. Rejects with `AccountCancelled`
   * when the user dismisses sign-in or `signal` aborts.
   */
  requestSessionToken(input: { readonly signal: AbortSignal }): Promise<string>;
  /**
   * Focus a window awaiting sign-in. Starts nothing, and the pending request
   * keeps its id.
   */
  focus(): void;
  /** For display only; never a credential. */
  state(): AccountState;
  /** Sign out of Clerk on this Mac. The link and remote access are unchanged. */
  signOut(): Promise<void>;
  /** Reject pending requests. Idempotent. */
  close(): Promise<void>;
}

export type AccountState =
  /** This build has no Clerk configuration. */
  | { readonly kind: "unavailable" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "signed_in"; readonly label: string };

export class AccountCancelled extends Error {
  constructor() {
    super("Sign-in was cancelled");
    this.name = "AccountCancelled";
  }
}
