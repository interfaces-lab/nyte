import { randomUUID } from "node:crypto";
import { AccountCancelled } from "../main/account-session.ts";
import type { AccountAnswer, AccountCommand, AccountFailure } from "./protocol.ts";

type Pending =
  | {
      readonly id: string;
      readonly kind: "token";
      readonly resolve: (token: string) => void;
      readonly reject: (error: Error) => void;
      readonly release: () => void;
    }
  | {
      readonly id: string;
      readonly kind: "sign_out";
      readonly resolve: () => void;
      readonly reject: (error: Error) => void;
      readonly release: () => void;
    };

const FAILURES: Record<AccountFailure, string> = {
  impersonated: "An impersonated session can't link this Mac.",
  no_token: "Clerk didn't issue a session token. Try again.",
  sign_out_failed: "Clerk couldn't sign out. Try again.",
  unreachable: "Nyte can't reach the account service. Try again.",
};

/**
 * The single operation the sign-in dialog serves. Each one has a fresh id, and
 * only an answer naming the current id settles it, so an answer that arrives
 * after a close, an abort, or a newer request is dropped. A newer request
 * cancels the one before it.
 */
export class AccountOperations {
  #pending: Pending | undefined;

  readonly #newId: () => string;

  constructor(newId: () => string = randomUUID) {
    this.#newId = newId;
  }

  current(): AccountCommand | undefined {
    return this.#pending === undefined
      ? undefined
      : { id: this.#pending.id, kind: this.#pending.kind };
  }

  requestToken(signal: AbortSignal) {
    const id = this.#newId();

    const result = new Promise<string>((resolve, reject) => {
      if (signal.aborted) {
        reject(new AccountCancelled());

        return;
      }

      const abort = (): void => this.cancel(id);

      signal.addEventListener("abort", abort, { once: true });
      this.#replace({
        id,
        kind: "token",
        resolve,
        reject,
        release: () => signal.removeEventListener("abort", abort),
      });
    });

    return { id, result };
  }

  requestSignOut() {
    const id = this.#newId();

    const result = new Promise<void>((resolve, reject) => {
      this.#replace({ id, kind: "sign_out", resolve, reject, release: () => undefined });
    });

    return { id, result };
  }

  /** True when the answer settled the current operation. */
  settle(answer: AccountAnswer): boolean {
    const pending = this.#pending;

    if (pending === undefined || pending.id !== answer.id) return false;

    if (answer.kind === "cancelled") {
      this.#finish(pending).reject(new AccountCancelled());

      return true;
    }

    if (answer.kind === "failed") {
      this.#finish(pending).reject(new Error(FAILURES[answer.reason]));

      return true;
    }

    if (pending.kind === "token" && answer.kind === "token") {
      this.#finish(pending).resolve(answer.token);

      return true;
    }

    if (pending.kind === "sign_out" && answer.kind === "signed_out") {
      this.#finish(pending).resolve();

      return true;
    }

    return false;
  }

  /** Rejects the current operation, or only `id` when given, with `AccountCancelled`. */
  cancel(id?: string): void {
    this.fail(new AccountCancelled(), id);
  }

  fail(error: Error, id?: string): void {
    const pending = this.#pending;

    if (pending === undefined || (id !== undefined && pending.id !== id)) return;
    this.#finish(pending).reject(error);
  }

  #finish<P extends Pending>(pending: P): P {
    this.#pending = undefined;
    pending.release();

    return pending;
  }

  #replace(next: Pending): void {
    const previous = this.#pending;

    this.#pending = next;

    if (previous === undefined) return;
    previous.release();
    previous.reject(new AccountCancelled());
  }
}
