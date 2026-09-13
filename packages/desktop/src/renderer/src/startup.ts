/**
 * The HTML startup shell stays up until the interface can paint complete:
 * local caches filled, the initial route resolved, and that route's first
 * screen warmed. The shell then mounts once, so the first React frame shows
 * the sidebar and the last chat rather than placeholders that fill in.
 */
export interface RendererStartupOptions {
  /** Replace the startup shell with the interface. Runs once, when everything below has landed. */
  readonly mountShell: () => void;
  readonly loadResources: () => Promise<void>;
  readonly loadRouter: () => Promise<void>;
  /** Fill the data the initial route paints from. Slowness or failure never holds startup. */
  readonly warmInitialScreen?: () => Promise<void>;
  /** Startup could not finish; the shell shows it and offers `retry`. */
  readonly showError: (retry: () => void) => void;
  readonly onReady?: () => void;
}

/** Local reads answer in tens of milliseconds; a warm that runs longer paints behind the mounted screen instead. */
const INITIAL_SCREEN_WARM_MS = 1_500;

function bounded(warm: Promise<void>, limitMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, limitMs);
    const settle = (): void => {
      clearTimeout(timer);
      resolve();
    };
    warm.then(settle, settle);
  });
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
      if (options.warmInitialScreen !== undefined) {
        await bounded(options.warmInitialScreen(), INITIAL_SCREEN_WARM_MS);
      }
      loading = false;
      options.mountShell();
      options.onReady?.();
    })();
  };

  load();
}
