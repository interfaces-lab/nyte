interface RendererStartupOptions {
  /** Replace the startup shell with the interface. Runs once, when everything below has landed. */
  readonly mountShell: () => void;
  readonly loadResources: () => Promise<void>;
  readonly loadRouter: () => Promise<void>;
  /** Startup could not finish; the shell shows it and offers `retry`. */
  readonly showError: (retry: () => void) => void;
  readonly onReady?: () => void;
}

export function startRendererStartup(options: RendererStartupOptions): void {
  let loading = false;

  const load = (): void => {
    if (loading) return;
    loading = true;
    void (async () => {
      try {
        await options.loadResources();

        if (performance.getEntriesByName("nyte:startup-resources-loaded").length === 0)
          performance.mark("nyte:startup-resources-loaded");
        await options.loadRouter();

        if (performance.getEntriesByName("nyte:route-ready").length === 0)
          performance.mark("nyte:route-ready");
      } catch {
        loading = false;
        options.showError(load);

        return;
      }

      loading = false;
      options.mountShell();
      options.onReady?.();
    })();
  };

  load();
}
