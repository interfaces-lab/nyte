/**
 * Running provider sign-ins, keyed by provider, each one iterating the steps
 * of the host's `models.login` flow. The view holds what the flow shows: a
 * device code, the page to finish on, its latest word. Dropping the iterator
 * cancels the attempt, never a saved account.
 */
import { useSyncExternalStore } from "react";
import type { DeviceCode } from "../bridge.ts";
import { nyte } from "../nyte.ts";
import { connection } from "../sdk.tsx";

/** The page a browser sign-in finishes on; `acceptsCode` when the flow wants the code it ends on pasted back. */
export interface BrowserSignIn {
  readonly url: string;
  readonly instructions?: string;
  readonly acceptsCode: boolean;
}

interface LoginAttemptView {
  readonly attempt: string;
  readonly method: "browser" | "api_key";
  /** Stays for the attempt's whole life; a later message never replaces it. */
  readonly deviceCode: DeviceCode | undefined;
  /** The page to finish on. */
  readonly browser: BrowserSignIn | undefined;
  /** The flow's latest word, if it said anything. */
  readonly message: string | undefined;
  readonly cancelling: boolean;
}

/** How an attempt ended: a saved credential, or the user stopped it. */
export type LoginOutcome = { readonly kind: "connected" } | { readonly kind: "cancelled" };

interface Running {
  readonly view: LoginAttemptView;
  readonly answer: (code: string) => Promise<void>;
  readonly cancel: () => void;
}

let attempts: ReadonlyMap<string, Running> = new Map();

const listeners = new Set<() => void>();

function set(provider: string, running: Running | undefined): void {
  const next = new Map(attempts);

  if (running === undefined) next.delete(provider);
  else next.set(provider, running);
  attempts = next;

  for (const listener of listeners) listener();
}

function patch(provider: string, attempt: string, change: Partial<LoginAttemptView>): void {
  const current = attempts.get(provider);

  if (current?.view.attempt === attempt)
    set(provider, { ...current, view: { ...current.view, ...change } });
}

/**
 * Runs one sign-in to its end. A browser flow opens the page it names; an API
 * key answers the flow's paste step; a choice takes the first option offered.
 * A new attempt for the provider cancels the previous one.
 */
export async function startLogin(
  provider: string,
  method: { readonly kind: "browser" } | { readonly kind: "api_key"; readonly key: string },
): Promise<LoginOutcome> {
  attempts.get(provider)?.cancel();
  const attempt = crypto.randomUUID();
  const login = connection().models.login({
    provider,
    method: method.kind === "browser" ? { kind: "oauth" } : { kind: "key" },
  });
  const steps = login.steps()[Symbol.asyncIterator]();
  const cancelled = Promise.withResolvers<"cancelled">();

  set(provider, {
    view: {
      attempt,
      method: method.kind,
      deviceCode: undefined,
      browser: undefined,
      message: undefined,
      cancelling: false,
    },
    answer: (code) => login.answer(code),
    cancel: () => {
      patch(provider, attempt, { cancelling: true });
      cancelled.resolve("cancelled");
      void steps.return?.();
    },
  });

  try {
    for (;;) {
      const next = await Promise.race([steps.next(), cancelled.promise]);

      if (next === "cancelled" || next.done === true) return { kind: "cancelled" };
      const step = next.value;

      switch (step.kind) {
        case "open":
          if (step.code === undefined) {
            patch(provider, attempt, { browser: { url: step.url, acceptsCode: false } });
            void nyte.host.openExternal({ url: step.url }).catch(() => undefined);
          } else {
            patch(provider, attempt, {
              deviceCode: { userCode: step.code, verificationUri: step.url },
              message: undefined,
            });
          }

          break;
        case "paste":
          if (method.kind === "api_key") await login.answer(method.key);
          else {
            const browser = attempts.get(provider)?.view.browser;
            patch(provider, attempt, {
              message: step.message,
              ...(browser === undefined ? {} : { browser: { ...browser, acceptsCode: true } }),
            });
          }

          break;
        case "choose":
          patch(provider, attempt, { message: step.message });

          if (step.options[0] !== undefined) await login.answer(step.options[0].id);

          break;
        case "waiting":
          break;
        case "done":
          return { kind: "connected" };
        case "failed":
          throw new Error(step.reason);
        default: {
          const exhaustive: never = step;

          return exhaustive;
        }
      }
    }
  } finally {
    if (attempts.get(provider)?.view.attempt === attempt) set(provider, undefined);
  }
}

/** Stops a running sign-in; one that already ended is a no-op. */
export function cancelLogin(provider: string): void {
  attempts.get(provider)?.cancel();
}

/** Sends the code or address a browser sign-in's page ended on. */
export function answerLogin(provider: string, code: string): Promise<void> {
  const running = attempts.get(provider);

  return running === undefined ? Promise.resolve() : running.answer(code);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** The running sign-in for a provider, if any. */
export function useLoginAttempt(provider: string): LoginAttemptView | undefined {
  const read = (): LoginAttemptView | undefined => attempts.get(provider)?.view;

  return useSyncExternalStore(subscribe, read, read);
}
