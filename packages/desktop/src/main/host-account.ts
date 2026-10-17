/**
 * The Nyte account across the process line: Clerk's sign-in lives in main with the windows,
 * and Connect, which needs a session token to link this Mac, runs in the host process. The host
 * asks main for one `AccountCall` at a time; main pushes each account state change.
 */
import { AccountCancelled } from "./account-session.ts";
import type { AccountSession, AccountState } from "./account-session.ts";

export type AccountCall =
  | { readonly method: "token" }
  | { readonly method: "focus" }
  | { readonly method: "signOut" }
  | { readonly method: "close" };

export type AccountAnswer =
  | { readonly kind: "token"; readonly token: string }
  | { readonly kind: "cancelled" }
  | { readonly kind: "done" };

/** Main's side: runs one call against the signed-in account. `signal` aborts a pending token request. */
export async function answerAccount(
  account: AccountSession,
  call: AccountCall,
  signal: AbortSignal,
): Promise<AccountAnswer> {
  switch (call.method) {
    case "token":
      try {
        return { kind: "token", token: await account.requestSessionToken({ signal }) };
      } catch (cause) {
        if (cause instanceof AccountCancelled) return { kind: "cancelled" };

        throw cause;
      }

    case "focus":
      account.focus();

      return { kind: "done" };
    case "signOut":
      await account.signOut();

      return { kind: "done" };
    case "close":
      await account.close();

      return { kind: "done" };
    default: {
      const _exhaustive: never = call;

      return _exhaustive;
    }
  }
}

/** The host process's side: the account as main last described it, each action asked of main. */
export class RemoteAccount implements AccountSession {
  readonly #ask: (call: AccountCall, signal?: AbortSignal) => Promise<AccountAnswer>;
  #state: AccountState;

  constructor(
    state: AccountState,
    ask: (call: AccountCall, signal?: AbortSignal) => Promise<AccountAnswer>,
  ) {
    this.#state = state;
    this.#ask = ask;
  }

  /** Main reported a sign-in, a sign-out or a new label. */
  changed(state: AccountState): void {
    this.#state = state;
  }

  async requestSessionToken(input: { readonly signal: AbortSignal }): Promise<string> {
    const answer = await this.#ask({ method: "token" }, input.signal);

    if (answer.kind !== "token") throw new AccountCancelled();

    return answer.token;
  }

  focus(): void {
    void this.#ask({ method: "focus" }).catch(() => undefined);
  }

  state(): AccountState {
    return this.#state;
  }

  async signOut(): Promise<void> {
    await this.#ask({ method: "signOut" });
  }

  async close(): Promise<void> {
    await this.#ask({ method: "close" }).catch(() => undefined);
  }
}
