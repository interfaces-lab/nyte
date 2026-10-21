import { useLayoutEffect } from "react";
import { tracing } from "@nyte-ai/sdk";

declare global {
  interface Window {
    nyteWorkCounts?: Record<string, number>;
  }
}

/** Counts one selection or publication under `name` while tracing is on, so a test can read `window.nyteWorkCounts` to compare how much work two builds did. */
export function countWork(name: string): void {
  if (!tracing.enabled) return;
  const counts = (window.nyteWorkCounts ??= {});
  counts[name] = (counts[name] ?? 0) + 1;
}

/** Counts each commit of the calling component under `name`, after the commit so the React Compiler cannot memoize the count away. */
export function useCommitCount(name: string): void {
  useLayoutEffect(() => countWork(name));
}
