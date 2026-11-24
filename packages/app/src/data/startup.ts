import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import type { ConnectionProblem } from "../contract/connection.ts";

export type StartupProblem = ConnectionProblem["kind"];

type StartupConnection =
  | { readonly kind: "connecting" }
  | { readonly kind: "connected" }
  | { readonly kind: "unreachable" }
  | { readonly kind: "failed"; readonly problem: StartupProblem; readonly retry: () => void };

let connectionState: StartupConnection = { kind: "connecting" };

const listeners = new Set<() => void>();

export function publishStartupConnection(state: StartupConnection): void {
  connectionState = state;

  for (const listener of listeners) listener();
}

export const startupConnection = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
  },
  read: (): StartupConnection => connectionState,
};

const startupReads = Promise.withResolvers<void>();

let holdingStartupReads = false;

let waitingScreens = 0;

export function holdStartupReads(): void {
  holdingStartupReads = true;
}

export function startupReadsReleased(): Promise<void> {
  return holdingStartupReads ? startupReads.promise : Promise.resolve();
}

export function releaseStartupReads(): void {
  if (!holdingStartupReads) return;

  const release = (): void => {
    if (waitingScreens > 0) return;
    holdingStartupReads = false;
    startupReads.resolve();
  };

  requestAnimationFrame(() => {
    if ("requestIdleCallback" in window) requestIdleCallback(release, { timeout: 500 });
    else requestAnimationFrame(release);
  });
}

export function StartupReadsHold(): null {
  useMountEffect(() => {
    waitingScreens += 1;

    return () => {
      waitingScreens -= 1;
      releaseStartupReads();
    };
  });

  return null;
}
