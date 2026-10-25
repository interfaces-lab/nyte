import type { Login } from "@nyte-ai/sdk";
import { useSyncExternalStore } from "react";
import type { DeviceCode } from "../bridge.ts";
import { nyte } from "../nyte.ts";
import { openExternal } from "../open-external.ts";
import { connection } from "../sdk.tsx";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface BrowserSignIn {
  readonly url: string;
  readonly acceptsCode: boolean;
}

interface LoginAttemptView {
  readonly attempt: string;
  readonly method: "browser" | "api_key";
  readonly deviceCode: DeviceCode | undefined;
  readonly browser: BrowserSignIn | undefined;
  readonly cancelling: boolean;
}

type LoginOutcome = { readonly kind: "connected" } | { readonly kind: "cancelled" };

interface Running {
  readonly view: LoginAttemptView;
  readonly answer: (code: string) => Promise<void>;
  readonly cancel: () => void;
}

let attempts: ReadonlyMap<string, Running> = new Map();

const listeners = new Set<() => void>();

function set(key: string, running: Running | undefined): void {
  const next = new Map(attempts);

  if (running === undefined) next.delete(key);
  else next.set(key, running);
  attempts = next;

  for (const listener of listeners) listener();
}

function patch(key: string, attempt: string, change: Partial<LoginAttemptView>): void {
  const current = attempts.get(key);

  if (current?.view.attempt === attempt)
    set(key, { ...current, view: { ...current.view, ...change } });
}

type LoginMethod =
  | { readonly kind: "browser" }
  | { readonly kind: "api_key"; readonly key: string };

export async function startLogin(provider: string, method: LoginMethod): Promise<LoginOutcome> {
  const endpoint = new URL((await nyte.host.endpoint()).url);

  return runLogin(provider, method, () =>
    connection().models.login({
      provider,
      method: method.kind === "browser" ? { kind: "oauth" } : { kind: "key" },
      browser: LOOPBACK.has(endpoint.hostname) ? "host" : "elsewhere",
    }),
  );
}

export async function runLogin(
  key: string,
  method: LoginMethod,
  begin: () => Login,
): Promise<LoginOutcome> {
  attempts.get(key)?.cancel();
  const attempt = crypto.randomUUID();
  const login = begin();
  const steps = login.steps()[Symbol.asyncIterator]();
  const cancelled = Promise.withResolvers<"cancelled">();

  set(key, {
    view: {
      attempt,
      method: method.kind,
      deviceCode: undefined,
      browser: undefined,
      cancelling: false,
    },
    answer: (code) => login.answer(code),
    cancel: () => {
      patch(key, attempt, { cancelling: true });
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
            patch(key, attempt, { browser: { url: step.url, acceptsCode: false } });
            openExternal(
              step.url,
              "Couldn't open the sign-in page. Use Open Sign-In Page instead.",
            );
          } else {
            patch(key, attempt, {
              deviceCode: { userCode: step.code, verificationUri: step.url },
            });
          }

          break;
        case "paste":
          if (method.kind === "api_key") await login.answer(method.key);
          else {
            const browser = attempts.get(key)?.view.browser;

            if (browser !== undefined)
              patch(key, attempt, { browser: { ...browser, acceptsCode: true } });
          }

          break;
        case "choose":
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
    if (attempts.get(key)?.view.attempt === attempt) set(key, undefined);
  }
}

export function cancelLogin(key: string): void {
  attempts.get(key)?.cancel();
}

export function answerLogin(key: string, code: string): Promise<void> {
  const running = attempts.get(key);

  return running === undefined ? Promise.resolve() : running.answer(code);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function useLoginAttempt(key: string): LoginAttemptView | undefined {
  const read = (): LoginAttemptView | undefined => attempts.get(key)?.view;

  return useSyncExternalStore(subscribe, read, read);
}
