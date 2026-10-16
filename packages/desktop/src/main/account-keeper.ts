import { Value } from "typebox/value";
import type { AccountState } from "./account-session.ts";
import type { AccountStore } from "./account-store.ts";

/** The sign-in main holds for Clerk: its client token and the account it describes. */
type SignInKeeper = {
  readonly state: () => AccountState;
  /** The renderer's report of who Clerk has signed in. */
  readonly report: (next: AccountState) => void;
  /** Clerk's client token, the saved one opened on first read. */
  readonly readToken: () => Promise<string | null>;
  /** Clerk replaced or cleared its client token. */
  readonly writeToken: (token: string | null) => void;
  /** The user signed out: forget the token and the saved sign-in. */
  readonly signOut: () => void;
};

/**
 * Keeps the sign-in in line with the store across restarts: the store holds a
 * sign-in once both the client token and the account describe one. A restored
 * token stays `sealed` until Clerk first asks for it. One the keychain cannot
 * open leaves the run signed out and `unopened`: the file keeps it until this
 * run signs in or signs out, so one keychain failure never deletes it. `kept`
 * is what this run last saved, undefined while the file may hold a restored
 * token. A failure to seal, open, or write leaves the file as it was and warns
 * once per run.
 */
export function createSignInKeeper(
  store: AccountStore | undefined,
  onChange: () => void,
): SignInKeeper {
  let state: AccountState = { kind: "signed_out" };
  let clientToken: string | null = null;
  let sealed: string | undefined;
  let unopened = false;
  let opening: Promise<void> | undefined;
  let kept: { readonly signIn: Parameters<AccountStore["save"]>[0] } | undefined;
  let storeWarned = false;

  const storeFailed = (cause: unknown): void => {
    if (storeWarned) return;
    storeWarned = true;
    process.emitWarning(`The saved sign-in could not be kept: ${String(cause)}`, {
      code: "NYTE_ACCOUNT_STORE",
    });
  };

  const keep = (): void => {
    if (store === undefined || sealed !== undefined) return;

    const next = {
      signIn:
        clientToken !== null && state.kind === "signed_in"
          ? { token: clientToken, label: state.label }
          : undefined,
    };

    if (next.signIn === undefined && unopened) return;
    unopened = false;

    if (Value.Equal(kept, next)) return;
    kept = next;
    void store.save(next.signIn).catch((cause: unknown) => {
      if (kept === next) kept = undefined;
      storeFailed(cause);
    });
  };

  const report = (next: AccountState): void => {
    if (
      next.kind === state.kind &&
      (next.kind !== "signed_in" || (state.kind === "signed_in" && state.label === next.label))
    )
      return;
    state = next;
    keep();
    onChange();
  };

  const restoring = store?.load().then((saved) => {
    if (saved === undefined || clientToken !== null || state.kind !== "signed_out") return;
    sealed = saved.sealed;
    report({ kind: "signed_in", label: saved.label });
  });

  const unseal = async (): Promise<void> => {
    const restored = sealed;

    if (store === undefined || restored === undefined) return;

    let opened: string | undefined;

    try {
      opened = await store.open(restored);
    } catch (cause) {
      storeFailed(cause);
    }

    if (sealed !== restored) return;
    sealed = undefined;

    if (opened !== undefined) {
      clientToken = opened;

      return;
    }

    unopened = true;
    state = { kind: "signed_out" };
    onChange();
  };

  return {
    state: () => state,
    report,
    readToken: async () => {
      await restoring;
      await (opening ??= unseal());

      return clientToken;
    },
    writeToken: (token) => {
      clientToken = token;
      sealed = undefined;
      keep();
    },
    signOut: () => {
      clientToken = null;
      sealed = undefined;
      unopened = false;
      report({ kind: "signed_out" });
      keep();
    },
  };
}
