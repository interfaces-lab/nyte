/**
 * The HTML startup shell stays up until the interface can paint complete:
 * local caches filled, the initial route resolved, and that route's first
 * screen warmed. The shell then mounts once, so the first React frame shows
 * the sidebar and the last chat rather than placeholders that fill in.
 */
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
        await options.loadRouter();
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
