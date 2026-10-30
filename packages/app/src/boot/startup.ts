import type { AppRouter } from "../shell/routes.tsx";
import {
  holdStartupReads,
  publishStartupConnection,
  releaseStartupReads,
} from "../data/startup.ts";

interface RendererStartupOptions {
  readonly fonts: readonly string[];
  readonly router: Pick<AppRouter, "load">;
  readonly mountShell: () => void;
  readonly connect: () => Promise<void>;
  readonly showError: (retry: () => void) => void;
}

const STARTUP_READS_FALLBACK_MS = 1000;

function mark(name: string): void {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name);
}

export function startRendererStartup(options: RendererStartupOptions): void {
  const { connect } = options;
  let loading = false;
  holdStartupReads();

  const open = (): void => {
    publishStartupConnection({ kind: "connecting" });
    connect().then(
      () => {
        publishStartupConnection({ kind: "connected" });
        setTimeout(releaseStartupReads, STARTUP_READS_FALLBACK_MS);
      },
      () => publishStartupConnection({ kind: "failed", retry: open }),
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
