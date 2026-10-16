interface RendererStartupOptions {
  /** Replace the startup shell with the interface. Runs once, when the local work below has landed. */
  readonly mountShell: () => void;
  /** What the first frame needs that no host connection gates: fonts, the window's tabs, host state. */
  readonly loadResources: () => Promise<void>;
  readonly loadRouter: () => Promise<void>;
  /**
   * The host connection. It opens once the shell has mounted: the composer
   * takes input while it runs, and the connection's own main-thread work
   * cannot hold back the first frame.
   */
  readonly connect?: () => Promise<void>;
  /** The local work failed; the startup shell shows it and offers `retry`. */
  readonly showError: (retry: () => void) => void;
  readonly onReady?: () => void;
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
 * Mounts the interface as soon as its local resources and route are ready,
 * then opens the host connection under it. A local failure keeps the startup
 * shell up with a retry; a connection failure leaves the shell mounted and
 * publishes a retry through `startupConnection`.
 */
export function startRendererStartup(options: RendererStartupOptions): void {
  const { connect } = options;
  let loading = false;

  const open = (): void => {
    if (connect === undefined) return;
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
        await options.loadResources();
        mark("nyte:startup-resources-loaded");
        await options.loadRouter();
        mark("nyte:route-ready");
      } catch {
        loading = false;
        options.showError(load);

        return;
      }

      loading = false;
      options.mountShell();
      options.onReady?.();
      open();
    })();
  };

  load();
}
