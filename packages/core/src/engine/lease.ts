import { dev } from "../util/dev-log.ts";

/** A claim kept alive while work runs under it. */
export interface Lease {
  /** Aborts once the claim is lost: a renewal was refused, or the claim lapsed and the next renewal didn't land. */
  readonly signal: AbortSignal;
  stop(): void;
}

/**
 * Renews a claim every `every` ms until stopped. `renew` answers whether the claim is still this
 * holder's. A refusal aborts `signal`. Once `lapse` ms pass without a renewal that landed, as when
 * the machine slept, another holder may have taken the claim, so the next renewal decides: the work
 * keeps running only if it lands, and aborts if it is refused, throws, or still hangs at the lapse.
 * A renewal that throws before the lapse is retried at the next tick.
 */
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
