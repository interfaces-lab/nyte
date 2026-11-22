import type { HeadName, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { dev } from "../util/dev-log.ts";

const DISPATCH_RETRIES = 3;

const DISPATCH_BACKOFF_MS = 50;

export function dispatchHead(
  kernel: Kernel,
  execution: Extract<Kernel["execution"], { readonly kind: "dispatch" }>,
  session: SessionId,
  head: HeadName,
): void {
  const pending = kernel.executionState.pending;
  const key = JSON.stringify([session, head]);

  if (pending.has(key)) {
    pending.set(key, true);

    return;
  }

  pending.set(key, false);

  void (async () => {
    for (let tries = 0; tries <= DISPATCH_RETRIES; tries += 1) {
      if (tries > 0) {
        await new Promise((resolve) => setTimeout(resolve, DISPATCH_BACKOFF_MS * 2 ** tries));
      }
      dev("execution", "dispatch", { session, head, tries });

      const dispatched = await Promise.resolve()
        .then(() => execution.dispatch({ session, head }))
        .then(
          () => true,
          () => false,
        );

      if (dispatched) break;
    }

    const again = pending.get(key) === true;
    pending.delete(key);

    if (again) dispatchHead(kernel, execution, session, head);
  })();
}
