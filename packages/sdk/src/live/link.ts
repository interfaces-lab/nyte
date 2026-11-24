import { SdkError } from "@nyte-ai/schema";
import type { BuildMatch, ClosingReason } from "@nyte-ai/schema";
import { listenerSet } from "./store.ts";
import type { Live } from "./store.ts";

export type LinkState =
  | { readonly kind: "connecting" }
  | {
      readonly kind: "open";
      readonly since: number;
      readonly version: string;
      readonly startedAt: number;
      readonly match: BuildMatch;
    }
  | {
      readonly kind: "away";
      readonly since: number;
      readonly retryAt: number;
      readonly reason: ClosingReason | "lost";
    }
  | {
      readonly kind: "refused";
      readonly reason: "auth" | "update-host" | "update-client" | "other-host";
      readonly error: SdkError;
    }
  | { readonly kind: "closed" };

export type HttpRefusal = Extract<LinkState, { readonly kind: "refused" }> & {
  readonly reason: "auth" | "other-host";
};

export interface LinkCell extends Live<LinkState> {
  readonly closed: AbortSignal;
  socket(next: LinkState): void;
  refuse(refusal: Omit<HttpRefusal, "kind">): void;
  retry(): void;
  close(): void;
}

const CLOSED: LinkState = { kind: "closed" };

export function linkCell(): LinkCell {
  const listeners = listenerSet();
  const controller = new AbortController();
  let socket: LinkState = { kind: "connecting" };
  let refused: HttpRefusal | null = null;

  const snapshot = (): LinkState => {
    if (controller.signal.aborted) return CLOSED;

    return refused ?? socket;
  };

  return {
    closed: controller.signal,
    snapshot,
    subscribe: listeners.subscribe,
    socket(next) {
      socket = next;
      listeners.notify();
    },
    refuse(refusal) {
      if (refused !== null) return;
      refused = { kind: "refused", ...refusal };
      listeners.notify();
    },
    retry() {
      if (refused === null) return;
      refused = null;
      listeners.notify();
    },
    close() {
      if (controller.signal.aborted) return;
      controller.abort(new SdkError("unavailable", "This connection is closed."));
      listeners.notify();
    },
  };
}

export function untilOpen(link: Live<LinkState>, ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();

      return;
    }

    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      unsubscribe();
      resolve();
    };

    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });

    const unsubscribe = link.subscribe(() => {
      if (link.snapshot().kind === "open") done();
    });
  });
}
