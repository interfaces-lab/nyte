/**
 * The provider half of a host's environment: catalog, preferences, sign-in
 * attempts, and usage reads. The host supplies each read and write as a
 * callback. This module owns the sign-in attempts clients poll, so a desktop
 * and a server answer them the same way.
 */
import type { Models, ProviderAuthInteraction } from "@nyte-ai/ai";
import { NyteClosed } from "@nyte-ai/core";
import type {
  AccountUsage,
  Environment,
  EnvironmentOperation,
  LoginAttempt,
  LoginMethod,
  LoginOutcome,
  PreferenceChange,
  ProviderCatalog,
  UsageSnapshot,
  UsageWindow,
} from "@nyte-ai/protocol";

/** Every environment operation but GitHub's, which the host answers from its own service. */
export type ProviderOperation = Exclude<EnvironmentOperation, `environment.github.${string}`>;

export type ProviderEnvironment = Pick<Environment, ProviderOperation>;

export interface ProviderEnvironmentOptions {
  readonly catalog: () => Promise<ProviderCatalog>;
  /** Persist the change. The service answers with a fresh `catalog()` read. */
  readonly setPreference: (change: PreferenceChange) => Promise<void>;
  readonly usage: (window: UsageWindow) => Promise<UsageSnapshot>;
  readonly accountLimits: () => Promise<readonly AccountUsage[]>;
  /** Run the provider's flow and save its credential, as `Models.login` does. */
  readonly login: (...input: Parameters<Models["login"]>) => Promise<unknown>;
  /** Called after every saved credential. Resolves whether the provider's model list refreshed. */
  readonly refresh: (provider: string, signal: AbortSignal) => Promise<boolean>;
  readonly logout: (provider: string) => Promise<void>;
}

export interface ProviderEnvironmentService {
  readonly operations: ProviderEnvironment;
  /**
   * The same environment for one caller: sign-ins started through it are
   * cancelled when `owner` aborts. Everything else, including the attempts
   * themselves, stays shared.
   */
  owned(owner: AbortSignal): ProviderEnvironment;
  /**
   * The attempt's state now and after each change, ending with the state it
   * stopped in. An in-process host reads this instead of polling. Changes
   * between two reads coalesce into the latest state.
   */
  follow(attempt: string): AsyncIterable<LoginAttempt>;
  /** Cancel running sign-ins and wait for them to stop. Later sign-ins answer `closed`. */
  close(): Promise<void>;
}

interface Attempt {
  readonly provider: string;
  readonly controller: AbortController;
  /** Aborts with `controller` or with the owner that started the attempt. */
  readonly signal: AbortSignal;
  /** Resolves once the flow has stopped, whichever way it ended. */
  readonly settled: Promise<void>;
  state: LoginAttempt;
  /** Resolves at the next state change, which replaces it. */
  changed: PromiseWithResolvers<void>;
  /** Present while the flow waits for a pasted code or redirect address. */
  answer: ((code: string) => void) | undefined;
}

/** How long a finished attempt still answers its poll. */
const SETTLED_RETENTION_MS = 5 * 60_000;

const BROWSER_OPTION_ID = "browser";

export function createProviderEnvironment(
  options: ProviderEnvironmentOptions,
): ProviderEnvironmentService {
  const attempts = new Map<string, Attempt>();
  let closed = false;

  const setState = (entry: Attempt, state: LoginAttempt): void => {
    entry.state = state;
    entry.changed.resolve();
    entry.changed = Promise.withResolvers();
  };

  const setAnswer = (entry: Attempt, answer: Attempt["answer"]): void => {
    entry.answer = answer;

    if (entry.state.kind === "running" && entry.state.browser !== undefined) {
      setState(entry, {
        ...entry.state,
        browser: { ...entry.state.browser, acceptsCode: answer !== undefined },
      });
    }
  };

  /** Held until `environment.answerLogin`, the flow's own release, or the attempt's end. */
  const pastedCode = (entry: Attempt, promptSignal: AbortSignal | undefined): Promise<string> => {
    const release =
      promptSignal === undefined ? entry.signal : AbortSignal.any([entry.signal, promptSignal]);

    return new Promise((resolve, reject) => {
      const stop = (): void => {
        setAnswer(entry, undefined);
        reject(new Error("Sign-in no longer waits for a code"));
      };

      if (release.aborted) return stop();
      release.addEventListener("abort", stop, { once: true });
      setAnswer(entry, (code) => {
        release.removeEventListener("abort", stop);
        setAnswer(entry, undefined);
        resolve(code);
      });
    });
  };

  const interaction = (entry: Attempt, method: LoginMethod): ProviderAuthInteraction => ({
    signal: entry.signal,
    prompt: (prompt) => {
      if (prompt.type === "secret" && method.kind === "api_key") return Promise.resolve(method.key);

      if (
        prompt.type === "select" &&
        method.kind === "browser" &&
        prompt.options.some((option) => option.id === BROWSER_OPTION_ID)
      )
        return Promise.resolve(BROWSER_OPTION_ID);

      if (prompt.type === "manual_code") return pastedCode(entry, prompt.signal);

      return Promise.reject(
        new Error("Couldn't finish signing in here. Run `nyte login` in a terminal."),
      );
    },
    notify: (event) => {
      if (entry.signal.aborted || entry.state.kind !== "running") return;
      const running = entry.state;

      switch (event.type) {
        case "auth_url":
          setState(entry, {
            ...running,
            browser: {
              url: event.url,
              instructions: event.instructions,
              acceptsCode: entry.answer !== undefined,
            },
          });

          return;
        case "device_code":
          setState(entry, {
            ...running,
            deviceCode: {
              userCode: event.userCode,
              verificationUri: event.verificationUri,
              expiresInSeconds: event.expiresInSeconds,
              instructions: event.instructions,
            },
            message: undefined,
          });

          return;
        case "progress":
        case "info":
          setState(entry, { ...running, message: event.message });

          return;
        default: {
          const _exhaustive: never = event;

          return _exhaustive;
        }
      }
    },
  });

  /**
   * A superseded flow settles first: a credential it was already committing
   * would otherwise land beside this one's. A saved credential is `connected`
   * even when the model refresh after it fails or is cancelled.
   */
  const run = async (
    entry: Attempt,
    method: LoginMethod,
    superseded: readonly Attempt[],
  ): Promise<LoginOutcome> => {
    await Promise.all(superseded.map((previous) => previous.settled));
    const { signal } = entry;

    if (signal.aborted) return { kind: "cancelled" };

    try {
      await options.login(
        entry.provider,
        method.kind === "api_key" ? "api_key" : "oauth",
        interaction(entry, method),
      );
    } catch (error) {
      if (signal.aborted) return { kind: "cancelled" };
      throw error;
    }

    const catalogRefreshed = await options.refresh(entry.provider, signal).catch(() => false);

    return { kind: "connected", catalogRefreshed };
  };

  const settle = async (entries: readonly Attempt[]): Promise<void> => {
    for (const entry of entries) entry.controller.abort();
    await Promise.all(entries.map((entry) => entry.settled));
  };

  const login = async (
    { provider, method, attempt }: Parameters<ProviderEnvironment["environment.login"]>[0],
    owner: AbortSignal | undefined,
  ): Promise<LoginAttempt> => {
    const known = attempts.get(attempt);

    if (known !== undefined) return known.state;

    if (closed) throw new NyteClosed();
    const superseded = [...attempts.values()].filter((entry) => entry.provider === provider);

    for (const previous of superseded) previous.controller.abort();
    const settled = Promise.withResolvers<void>();
    const controller = new AbortController();

    const entry: Attempt = {
      provider,
      controller,
      signal: owner === undefined ? controller.signal : AbortSignal.any([controller.signal, owner]),
      settled: settled.promise,
      state: { kind: "running" },
      changed: Promise.withResolvers(),
      answer: undefined,
    };

    attempts.set(attempt, entry);
    void run(entry, method, superseded)
      .then(
        (outcome) => setState(entry, { kind: "settled", outcome }),
        () => setState(entry, { kind: "failed" }),
      )
      .finally(() => {
        // Releases a code prompt the flow left open.
        controller.abort();
        settled.resolve();
        setTimeout(() => {
          if (attempts.get(attempt) === entry) attempts.delete(attempt);
        }, SETTLED_RETENTION_MS).unref();
      });

    return entry.state;
  };

  const operations: ProviderEnvironment = {
    "environment.catalog": () => options.catalog(),
    "environment.setPreference": async (change) => {
      await options.setPreference(change);

      return options.catalog();
    },
    "environment.usage": (window) => options.usage(window),
    "environment.accountLimits": () => options.accountLimits(),
    "environment.login": (input) => login(input, undefined),
    "environment.loginAttempt": async ({ attempt }) =>
      attempts.get(attempt)?.state ?? { kind: "unknown" },
    "environment.answerLogin": async ({ attempt, code }) => {
      attempts.get(attempt)?.answer?.(code);
    },
    "environment.cancelLogin": async ({ attempt }) => {
      attempts.get(attempt)?.controller.abort();
    },
    // A sign-in mid-approval must not save a credential after this delete.
    "environment.logout": async ({ provider }) => {
      await settle([...attempts.values()].filter((entry) => entry.provider === provider));
      await options.logout(provider);
    },
  };

  return {
    operations,
    owned: (owner) => ({ ...operations, "environment.login": (input) => login(input, owner) }),
    async *follow(attempt) {
      for (;;) {
        const entry = attempts.get(attempt);

        if (entry === undefined) {
          yield { kind: "unknown" };

          return;
        }

        // Read before yielding, so a change while the consumer works resolves this one.
        const { state, changed } = entry;
        yield state;

        if (state.kind !== "running") return;
        await changed.promise;
      }
    },
    close: async () => {
      closed = true;
      await settle([...attempts.values()]);
    },
  };
}
