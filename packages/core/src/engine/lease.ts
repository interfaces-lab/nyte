import { dev } from "../util/dev-log.ts";

export interface Lease {
  readonly signal: AbortSignal;
  stop(): void;
}

export function holdLease(
  what: string,
  renew: () => Promise<boolean>,
  timing: { readonly every: number; readonly lapse: number },
): Lease {
  const lost = new AbortController();
  let renewed = Date.now();
  let renewing = false;
  let stopped = false;

  const stop = (): void => {
    stopped = true;
    clearInterval(timer);
  };

  const lose = (reason: string): void => {
    dev("lease", "lost", { what, reason });
    stop();
    lost.abort();
  };

  const timer = setInterval(() => {
    const lapsed = Date.now() - renewed >= timing.lapse;

    if (renewing) {
      if (lapsed) lose("lapsed");

      return;
    }

    renewing = true;

    renew()
      .then(
        (held) => {
          if (stopped) return;

          if (!held) return lose("refused");
          renewed = Date.now();
        },
        (error) => {
          dev("lease", "renewal failed", {
            what,
            error: error instanceof Error ? error.message : String(error),
          });

          if (lapsed && !stopped) lose("lapsed");
        },
      )
      .finally(() => {
        renewing = false;
      });
  }, timing.every);

  return { signal: lost.signal, stop };
}
