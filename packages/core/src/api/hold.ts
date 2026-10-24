import type {
  HoldLease,
  MessageId,
  ReviseOptions,
  ReviseOutcome,
  UserContent,
} from "@nyte-ai/schema";
import { HOLD_MS } from "../contract/session.ts";
import type { HeldMessage, HoldOutcome, ReleaseOutcome } from "../contract/session.ts";

const RENEW_MS = 5_000;

export async function holdMessage(
  message: MessageId,
  operations: {
    readonly hold: () => Promise<HoldLease>;
    readonly revise: (content: UserContent, options?: ReviseOptions) => Promise<ReviseOutcome>;
    readonly release: () => Promise<void>;
  },
): Promise<HoldOutcome> {
  const asked = Date.now();
  const first = await operations.hold();

  if (first.kind !== "held") return first;
  const lost = Promise.withResolvers<Awaited<HeldMessage["lost"]>>();
  const expired = Promise.withResolvers<void>();
  let renewing = true;
  let renewal = Promise.resolve();
  let released: Promise<ReleaseOutcome> | null = null;

  const stop = () => {
    renewing = false;
    clearTimeout(timer);
  };

  const lose = (reason: Awaited<HeldMessage["lost"]>) => {
    if (!renewing) return;
    stop();
    lost.resolve(reason);
  };

  const expire = () => {
    expired.resolve();
    lose({ kind: "lapsed" });
  };

  const renewLater = () => {
    if (renewing) timer = setTimeout(renew, RENEW_MS);
  };

  const renew = () => {
    const sent = Date.now();

    renewal = operations.hold().then((lease) => {
      if (lease.kind !== "held") return lose(lease);

      if (!renewing) return;
      clearTimeout(expiry);
      expiry = setTimeout(expire, sent + HOLD_MS - Date.now());
      renewLater();
    }, renewLater);
  };

  let timer = setTimeout(renew, RENEW_MS);
  let expiry = setTimeout(expire, asked + HOLD_MS - Date.now());

  const release = () => {
    stop();
    released ??= Promise.race([
      renewal
        .then(() => operations.release())
        .then(
          () => ({ kind: "released" }) as const,
          () => ({ kind: "lapsing" }) as const,
        ),
      expired.promise.then(() => ({ kind: "lapsing" }) as const),
    ]).finally(() => clearTimeout(expiry));

    return released;
  };

  return {
    kind: "held",
    message,
    lost: lost.promise,
    async save(content, options) {
      stop();
      const revised = await operations.revise(content, options);
      await release();

      return revised;
    },
    release,
    async [Symbol.asyncDispose]() {
      await release();
    },
  };
}
