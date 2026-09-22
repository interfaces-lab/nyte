/**
 * The renderer's handle on the SDK. `window.nyte` is the preload's bridge: the
 * SDK interfaces verbatim, `watch` as a push subscription, plus the host
 * namespace. This client keeps no state beyond query caches and cursors.
 */
import type { SessionEvent } from "@nyte-ai/protocol";
import type { SessionObserverClient } from "@nyte-ai/client";
import type { NyteBridge } from "../../shared/ipc.ts";

declare global {
  interface Window {
    readonly nyte: NyteBridge;
  }
}

export const nyte: NyteBridge = window.nyte;

type Watch = SessionObserverClient["watch"];

/**
 * The bridge's push subscription as the SDK's `watch`: events queue until
 * pulled, and the iteration ends once, whichever comes first: the bridge
 * fails (the pull rejects), the signal aborts, or the reader leaves. Every end
 * stops the subscription and drops what was queued, so no bridge listener
 * outlives the iteration. The observer reads it exactly like the SDK's own
 * iterable.
 */
function watchEvents(input: Parameters<Watch>[0]): AsyncIterable<SessionEvent> {
  return {
    [Symbol.asyncIterator]() {
      const queued: SessionEvent[] = [];
      let pull: PromiseWithResolvers<IteratorResult<SessionEvent>> | undefined;
      let ended: { readonly error: Error | undefined } | undefined;
      let stop = (): void => {};

      const end = (error: Error | undefined): void => {
        if (ended !== undefined) return;
        ended = { error };
        queued.length = 0;
        input.signal?.removeEventListener("abort", abort);
        stop();
        const waiting = pull;
        pull = undefined;

        if (waiting === undefined) return;

        if (error === undefined) waiting.resolve({ value: undefined, done: true });
        else waiting.reject(error);
      };

      const abort = (): void => end(undefined);

      if (input.signal?.aborted) {
        ended = { error: undefined };
      } else {
        stop = nyte.watch(
          "live" in input
            ? { sessionId: input.sessionId, live: true }
            : input.afterSeq === undefined
              ? { sessionId: input.sessionId }
              : { sessionId: input.sessionId, afterSeq: input.afterSeq },
          (event) => {
            if (ended !== undefined) return;

            if (pull === undefined) {
              queued.push(event);

              return;
            }

            const waiting = pull;
            pull = undefined;
            waiting.resolve({ value: event, done: false });
          },
          end,
        );

        // A bridge that refuses before returning ended without a stop to call.
        if (ended !== undefined) stop();
        else input.signal?.addEventListener("abort", abort, { once: true });
      }

      return {
        next: () => {
          const event = queued.shift();

          if (event !== undefined) return Promise.resolve({ value: event, done: false });

          if (ended !== undefined) {
            return ended.error === undefined
              ? Promise.resolve({ value: undefined, done: true })
              : Promise.reject(ended.error);
          }

          pull = Promise.withResolvers();

          return pull.promise;
        },
        return: () => {
          end(undefined);

          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

/** The SDK subset a `SessionObserver` reads and watches, over the bridge. */
export const sessionClient: SessionObserverClient = { sessions: nyte.sessions, watch: watchEvents };

export type {
  DesktopCatalog,
  DesktopModelOption,
  GitHubAccount,
  GitHubProviderState,
  GitHubPullRequest,
  GitHubPullRequestContext,
  GitHubRepository,
  HostEvent,
  HostState,
  LocalFontCatalog,
  OpenWorkspaceOutcome,
  PreferenceChange,
  ProviderStatus,
  SignInMethod,
  ThemePreference,
  UsageEntry,
  UsageReport,
  UsageSession,
  UsageSource,
  UsageSubject,
  UsageTotals,
  UsageWindow,
  WatchInput,
} from "../../shared/ipc.ts";
