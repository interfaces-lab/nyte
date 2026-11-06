import { useLayoutEffect } from "react";
import { tracing } from "@nyte-ai/sdk";

declare global {
  interface Window {
    nyteWorkCounts?: Record<string, number>;
  }
}

export function countWork(name: string): void {
  if (!tracing.enabled) return;
  const counts = (window.nyteWorkCounts ??= {});
  counts[name] = (counts[name] ?? 0) + 1;
}

export function useCommitCount(name: string): void {
  // oxlint-disable-next-line nyte-code/no-direct-effect -- counts commits; render-time counting would be memoized away or doubled
  useLayoutEffect(() => countWork(name));
}
