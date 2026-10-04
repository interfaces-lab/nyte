import { UnknownSession, type Nyte } from "@nyte-ai/core";
import type { sqlScan } from "./scan.ts";

function nextWake(outcome: Awaited<ReturnType<Nyte["advance"]>>, now: number): number | undefined {
  switch (outcome.kind) {
    case "continue":
    case "finished":
      return now + 1;
    case "retry":
      return outcome.at;
    case "waiting":
      return outcome.until;
    case "busy":
      return outcome.until + 1;
    case "fenced":
      return now + 1_000;
    case "idle":
      return undefined;
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}

export function createAlarmDriver({
  scan,
  advance,
  arm,
  now = Date.now,
  maxHeads = 32,
  budgetMs = 10_000,
  onError,
}: {
  scan: ReturnType<typeof sqlScan>;
  advance: Nyte["advance"];
  arm: (at: number) => Promise<void>;
  now?: () => number;
  maxHeads?: number;
  budgetMs?: number;
  onError: (cause: unknown) => void;
}) {
  if (
    !Number.isSafeInteger(maxHeads) ||
    maxHeads < 1 ||
    !Number.isFinite(budgetMs) ||
    budgetMs <= 0
  )
    throw new RangeError("Invalid alarm scan bounds");
  let writes = Promise.resolve();
  let revision = 0;
  let admissions = 0;
  let passStart: number | undefined;
  let running: Promise<void> | undefined;

  const rearm = (due: () => number) => {
    const write = writes.then(() => arm(Math.max(now() + 1, due())));
    writes = write.catch(() => undefined);

    return write;
  };

  const wake = () => rearm(() => now() + 1);

  async function tick() {
    await rearm(() => now() + 30_000);
    const started = now();
    let cursor = scan.load();

    if (cursor.session === "") passStart = revision;

    for (let count = 0; count < maxHeads && now() - started < budgetMs; count += 1) {
      const target = scan.next(cursor);

      if (target === undefined) {
        scan.save({ session: "", head: "", due: undefined });
        const due = Math.min(cursor.due ?? Infinity, now() + 60_000);
        await rearm(() => {
          if (passStart !== revision) return now() + 1;

          return admissions > 0 ? Math.min(due, now() + 30_000) : due;
        });

        return;
      }

      cursor = { session: target.sessionId, head: target.head ?? "main", due: cursor.due };
      scan.save(cursor);
      let due: number | undefined;

      try {
        due = nextWake(await advance(target), now());
      } catch (cause) {
        if (!(cause instanceof UnknownSession)) {
          onError(cause);
          due = now() + 30_000;
        }
      }

      if (due === undefined) continue;
      cursor = { ...cursor, due: Math.min(cursor.due ?? Infinity, due) };
      scan.save(cursor);
    }

    await wake();
  }

  return {
    wake,
    alarm(): Promise<void> {
      running ??= tick().finally(() => {
        running = undefined;
      });

      return running;
    },
    async submit<T>(run: () => Promise<T>): Promise<T> {
      admissions += 1;
      revision += 1;

      try {
        await wake();

        return await run();
      } finally {
        admissions -= 1;
        revision += 1;
        await wake();
      }
    },
  };
}
