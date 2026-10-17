import type { AppRouter } from "./router.tsx";

/**
 * What a renderer's first frame waits for. Only local work fits here: the
 * fonts it draws in and its route. Nothing the host answers can hold the
 * shell back; host data fills in underneath it.
 */
interface RendererStartupOptions {
  readonly fonts: readonly string[];
  readonly router: Pick<AppRouter, "load">;
  /**
   * Replace the empty page with the interface, and call `mounted` once it has committed. Runs
   * once, when the local work has landed.
   */
  readonly mountShell: (mounted: () => void) => void;
  /**
   * The host connection. It opens once the shell has mounted: the composer
   * takes input while it runs, and the connection's own main-thread work
   * cannot hold back the first frame.
   */
  readonly connect: () => Promise<void>;
  /** The local work failed; show it and offer `retry`. */
  readonly showError: (retry: () => void) => void;
}

/** Whether the host connection behind a mounted shell has opened. */
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

/** The startup connection, for `useSyncExternalStore`: the shell shows a failure with its retry. */
export const startupConnection = {
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
  },
  read: (): StartupConnection => connectionState,
};

function mark(name: string): void {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name);
}

/**
 * Mounts the interface as soon as its fonts and route are ready, then opens
 * the host connection under it. A local failure shows a retry; a connection
 * failure leaves the shell mounted and publishes a retry through
 * `startupConnection`.
 */
export function startRendererStartup(options: RendererStartupOptions): void {
  const { connect } = options;
  let loading = false;

  const open = (): void => {
    publish({ kind: "connecting" });
    connect().then(
      () => publish({ kind: "connected" }),
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
      options.mountShell(open);
    })();
  };

  load();
}
