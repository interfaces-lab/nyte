import { dev } from "../util/dev-log.ts";

/** A claim kept alive while work runs under it. */
export interface Lease {
  /** Aborts once the claim is lost: a renewal was refused, or none landed before the claim lapsed. */
  readonly signal: AbortSignal;
  stop(): void;
}

/**
 * Renews a claim every `every` ms until stopped. `renew` answers whether the claim is still this
 * holder's. A refusal, or `lapse` ms without a renewal that landed, aborts `signal`, so the work
 * stops once another holder may take the claim, whether the last renewal threw or still hangs; a
 * renewal that throws is retried at the next tick.
 */
export function holdLease(
  what: string,
  renew: () => Promise<boolean>,
  timing: { readonly every: number; readonly lapse: number },
): Lease {
  const lost = new AbortController();
  let renewed = Date.now();
  let renewing = false;

  const stop = (): void => clearInterval(timer);

  const lose = (reason: string): void => {
    dev("lease", "lost", { what, reason });
    stop();
    lost.abort();
  };

  const timer = setInterval(() => {
    if (Date.now() - renewed >= timing.lapse) return lose("lapsed");

    if (renewing) return;
    renewing = true;

    renew()
      .then(
        (held) => {
          if (lost.signal.aborted) return;

          if (!held) return lose("refused");
          renewed = Date.now();
        },
        (error) => {
          dev("lease", "renewal failed", {
            what,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      )
      .finally(() => {
        renewing = false;
      });
  }, timing.every);

  return { signal: lost.signal, stop };
}
