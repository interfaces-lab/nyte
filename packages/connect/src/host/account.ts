export interface AccountSession {
  requestSessionToken(input: { readonly signal: AbortSignal }): Promise<string>;
  focus(): void;
  state(): AccountState;
  signOut(): Promise<void>;
  close(): Promise<void>;
}

export type AccountState =
  | { readonly kind: "unavailable" }
  | { readonly kind: "signed_out" }
  | { readonly kind: "signed_in"; readonly label: string };

export class AccountCancelled extends Error {
  constructor() {
    super("Sign-in was cancelled");
    this.name = "AccountCancelled";
  }
}
