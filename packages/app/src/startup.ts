import { useLayoutEffect } from "react";
import type { AppRouter } from "./router.tsx";

interface RendererStartupOptions {
  readonly fonts: readonly string[];
  readonly router: Pick<AppRouter, "load">;
  readonly mountShell: () => void;
  readonly connect: () => Promise<void>;
  readonly showError: (retry: () => void) => void;
}

type StartupConnection =
  | { readonly kind: "connecting" }
  | { readonly kind: "connected" }
  | { readonly kind: "failed"; readonly retry: () => void };

let connectionState: StartupConnection = { kind: "connecting" };

const listeners = new Set<() => void>();

function publish(state: StartupConnection): void {
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

const STARTUP_READS_FALLBACK_MS = 1000;

const startupReads = Promise.withResolvers<void>();

let holdingStartupReads = false;

export function startupReadsReleased(): Promise<void> {
  return holdingStartupReads ? startupReads.promise : Promise.resolve();
}

function releaseStartupReads(): void {
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

export function useReleaseStartupReads(ready: boolean): void {
  useLayoutEffect(() => {
    if (ready) releaseStartupReads();
  }, [ready]);
}

function mark(name: string): void {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name);
}

export function startRendererStartup(options: RendererStartupOptions): void {
  const { connect } = options;
  let loading = false;
  holdingStartupReads = true;

  const open = (): void => {
    publish({ kind: "connecting" });
    connect().then(
      () => {
        publish({ kind: "connected" });
        setTimeout(releaseStartupReads, STARTUP_READS_FALLBACK_MS);
      },
      () => publish({ kind: "failed", retry: open }),
    );
  };

  const load = (): void => {
    if (loading) return;
    loading = true;
    void (async () => {
      try {
        await Promise.all(options.fonts.map((font) => document.fonts.load(font)));
        mark("nyte:startup-resources-loaded");
        await options.router.load();
        mark("nyte:route-ready");
      } catch {
        loading = false;
        options.showError(load);

        return;
      }

      loading = false;
      options.mountShell();
    })();
  };

  open();
  load();
}
