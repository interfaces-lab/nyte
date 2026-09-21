import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from "@pierre/diffs/react";
import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import PierreDiffWorkerUrl from "@pierre/diffs/worker/worker-portable.js?url";
import type { ReactElement, ReactNode } from "react";

const poolOptions = {
  workerFactory: () => new Worker(PierreDiffWorkerUrl, { type: "module" }),
  poolSize: 2,
  totalASTLRUCacheSize: 32,
} satisfies WorkerPoolOptions;

const highlighterOptions = {
  theme: { light: "github-light", dark: "github-dark" },
  lineDiffType: "word",
} satisfies WorkerInitializationRenderOptions;

/**
 * Wrap each Pierre surface, not the app. The provider resolves one module
 * singleton pool and counts mounted instances; the pool and its AST caches
 * are created by the first surface and terminated by the last, so nothing
 * runs while no diff or editor is on screen.
 */
export function PierreWorkerProvider({ children }: { readonly children: ReactNode }): ReactElement {
  return (
    <WorkerPoolContextProvider poolOptions={poolOptions} highlighterOptions={highlighterOptions}>
      {children}
    </WorkerPoolContextProvider>
  );
}
