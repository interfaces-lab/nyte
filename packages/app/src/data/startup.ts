import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import type { ConnectionProblem } from "../contract/connection.ts";

export type StartupProblem = Exclude<ConnectionProblem["kind"], "network">;

type StartupConnection =
  | { readonly kind: "connecting" }
  | { readonly kind: "migrating" }
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

export function holdStartupReads(): void {
  holdingStartupReads = true;
}

export function startupReadsReleased(): Promise<void> {
  return holdingStartupReads ? startupReads.promise : Promise.resolve();
}

export function releaseStartupReads(): void {
  if (!holdingStartupReads) return;

  const release = (): void => {
    holdingStartupReads = false;
    startupReads.resolve();
  };

  requestAnimationFrame(() => {
    if ("requestIdleCallback" in window) requestIdleCallback(release, { timeout: 500 });
    else setTimeout(release, 0);
  });
}

export function StartupReadsRelease(): null {
  useMountEffect(releaseStartupReads);

  return null;
}
