/**
 * Provider sign-in on a server's environment, in the host's terms. The server
 * never waits on a person: `environment.login` starts an attempt and this side
 * polls it, turning each new state into `login_progress` events and its end
 * into the outcome `host.login` resolves with.
 */
import type { NyteClient } from "@nyte-ai/client";
import type { LoginAttempt } from "@nyte-ai/protocol";
import type { HostBridge, HostEvent, LoginProgress } from "../bridge.ts";

const POLL_MS = 1_000;

type RunningAttempt = Extract<LoginAttempt, { readonly kind: "running" }>;

/** The address as a browser should open it, when it is a web page and nothing else. */
export function webPageUrl(value: string): string | undefined {
  const url = URL.parse(value);

  return url !== null && (url.protocol === "https:" || url.protocol === "http:")
    ? url.href
    : undefined;
}

/** Undefined when the server sent a link that is not a web page, which this app never opens. */
function progressOf(state: RunningAttempt): readonly LoginProgress[] | undefined {
  const progress: LoginProgress[] = [];

  if (state.deviceCode !== undefined) {
    const verificationUri = webPageUrl(state.deviceCode.verificationUri);

    if (verificationUri === undefined) return undefined;
    progress.push({
      kind: "device_code",
      userCode: state.deviceCode.userCode,
      verificationUri,
      expiresInSeconds: state.deviceCode.expiresInSeconds,
      instructions: state.deviceCode.instructions,
    });
  }

  if (state.browser !== undefined) {
    const url = webPageUrl(state.browser.url);

    if (url === undefined) return undefined;
    progress.push({
      kind: "browser",
      url,
      instructions: state.browser.instructions,
      acceptsCode: state.browser.acceptsCode,
    });
  }

  if (state.message !== undefined) progress.push({ kind: "message", message: state.message });

  return progress;
}

export function createEnvironmentSignIn({
  environment,
  emit,
}: {
  environment: NyteClient["environment"];
  emit: (event: HostEvent) => void;
}): Required<Pick<HostBridge, "login" | "cancelLogin" | "answerLogin">> {
  return {
    login: async ({ provider, method, attempt }) => {
      let state = await environment("environment.login", { provider, method, attempt });
      let shown = "";

      while (state.kind === "running") {
        const progress = progressOf(state);

        if (progress === undefined) {
          await environment("environment.cancelLogin", { attempt }).catch(() => undefined);
          throw new Error("The server sent a sign-in link that is not a web page.");
        }

        // A device code resets the message it replaces, so any change replays the whole state.
        const key = JSON.stringify(progress);

        if (key !== shown) {
          shown = key;

          for (const item of progress) {
            emit({ kind: "login_progress", attempt, provider, progress: item });
          }
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        state = await environment("environment.loginAttempt", { attempt });
      }

      switch (state.kind) {
        case "settled":
          if (state.outcome.kind === "connected") emit({ kind: "catalog_changed" });

          return state.outcome;
        case "failed":
          throw new Error(`Signing in to ${provider} failed.`);
        case "unknown":
          throw new Error(`The server no longer has this ${provider} sign-in.`);
        default: {
          const _exhaustive: never = state;

          return _exhaustive;
        }
      }
    },
    cancelLogin: (input) => environment("environment.cancelLogin", input),
    answerLogin: (input) => environment("environment.answerLogin", input),
  };
}
