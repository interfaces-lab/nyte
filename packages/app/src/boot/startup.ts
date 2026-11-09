import type { AppRouter } from "../shell/routes.tsx";
import type { StoreOpening } from "../contract/bridge.ts";
import {
  holdStartupReads,
  publishStartupConnection,
  releaseStartupReads,
  startupConnection,
} from "../data/startup.ts";
import { connectionProblem } from "../data/connection.ts";

interface RendererStartupOptions {
  readonly fonts: readonly string[];
  readonly router: Pick<AppRouter, "load">;
  readonly mountShell: () => void;
  readonly connect: () => Promise<void>;
  readonly storeOpening?: () => Promise<StoreOpening>;
  readonly showError: (retry: () => void) => void;
}

const STARTUP_READS_FALLBACK_MS = 1000;

const RETRY_MS = [250, 500, 1_000, 2_000] as const;

function mark(name: string): void {
  if (performance.getEntriesByName(name).length === 0) performance.mark(name);
}

export function startRendererStartup(options: RendererStartupOptions): void {
  const { connect } = options;
  let loading = false;
  let failures = 0;
  holdStartupReads();

  const open = (): void => {
    connect().then(
      () => {
        publishStartupConnection({ kind: "connected" });
        setTimeout(releaseStartupReads, STARTUP_READS_FALLBACK_MS);
      },
      (cause: unknown) => {
        const problem = connectionProblem(cause).kind;

        if (problem === "network") {
          setTimeout(open, RETRY_MS[Math.min(failures, RETRY_MS.length - 1)]);
          failures += 1;
          publishStartupConnection({ kind: "unreachable" });

          return;
        }

        publishStartupConnection({
          kind: "failed",
          problem,
          retry: () => {
            publishStartupConnection({ kind: "connecting" });
            open();
          },
        });
      },
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
  void options.storeOpening?.().then(
    (opening) => {
      if (opening === "migrating" && startupConnection.read().kind === "connecting")
        publishStartupConnection({ kind: "migrating" });
    },
    () => undefined,
  );
  load();
}
