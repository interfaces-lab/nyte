import type { MessageId } from "@nyte-ai/sdk";
import { useLayoutEffect, useRef, useState } from "react";
import { PLANNING_DELAY_MS, SLOW_PLANNING_MS } from "./step-group-presentation.ts";

export function usePlanningTime(planning: boolean, newest: MessageId | undefined): number {
  const [period, setPeriod] = useState({ planning, newest, id: 0 });
  const [elapsed, setElapsed] = useState({ period: 0, ms: 0 });
  const started = useRef<{ period: number; at: number }>(undefined);
  const id = period.id;

  if (period.planning !== planning || period.newest !== newest)
    setPeriod({ planning, newest, id: id + 1 });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- planning timers for the current period
  useLayoutEffect(() => {
    if (!planning) return undefined;
    const now = performance.now();
    const at = started.current?.period === id ? started.current.at : now;
    started.current = { period: id, at };
    const passed = now - at;

    if (passed >= PLANNING_DELAY_MS) setElapsed({ period: id, ms: passed });

    const timers = [PLANNING_DELAY_MS, SLOW_PLANNING_MS].flatMap((ms) =>
      ms > passed ? [window.setTimeout(() => setElapsed({ period: id, ms }), ms - passed)] : [],
    );

    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [planning, id]);

  return planning && elapsed.period === id ? elapsed.ms : 0;
}
