import { role } from "@nyte-ai/ui/vars.stylex";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import type { WorkerInitializationRenderOptions, WorkerPoolOptions } from "@pierre/diffs/worker";
import PierreDiffWorkerUrl from "@pierre/diffs/worker/worker-portable.js?url";
import { useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";

/** Half the cores, within reason: highlighting shares the machine with the agent. */
const POOL_SIZE = Math.max(2, Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

/**
 * How long a pool outlives its last surface. A transcript scrolling past its
 * diffs, or a tab switch, must not spawn workers and reload grammars again.
 */
const POOL_IDLE_MS = 30_000;

const poolOptions = {
  workerFactory: () => new Worker(PierreDiffWorkerUrl, { type: "module" }),
  poolSize: POOL_SIZE,
  // Highlights per file and per diff: enough that a review's every file stays
  // warm while it scrolls in and out of the viewport.
  totalASTLRUCacheSize: 240,
} satisfies WorkerPoolOptions;

/** Workers highlight with this pair; the editor's own tokenizer must match it. */
export const PIERRE_THEME = { light: "github-light", dark: "github-dark" } as const;

/** A selected tree row carries a hairline, so it reads apart from the hovered one. */
export const PIERRE_TREE_CSS = `
:host {
  --trees-action-lane-width-override: 24px;
}
[data-type="context-menu-trigger"] {
  margin: 0;
  height: var(--trees-row-height);
}
@media (pointer: coarse) {
  :host {
    --trees-action-lane-width-override: 44px;
  }
}

[data-type="item"][data-item-selected="true"] {
  box-shadow: inset 0 0 0 1px ${role.borderPrimary};
}
`;

/**
 * Pierre reads token weight, style, and decoration through light-dark(), which
 * accepts only colors, so Chromium drops bold and italic. The paired GitHub
 * themes agree on these, so the light values serve both schemes.
 */
export const PIERRE_TOKEN_CSS = `
[data-line] span,
[data-edit-prediction-suffix] span {
  font-weight: var(--diffs-token-light-font-weight, inherit);
  font-style: var(--diffs-token-light-font-style, inherit);
  text-decoration: var(--diffs-token-light-text-decoration, inherit);
}
`;

const highlighterOptions = {
  theme: PIERRE_THEME,
  lineDiffType: "word",
} satisfies WorkerInitializationRenderOptions;

interface SharedPool {
  readonly pool: WorkerPoolManager;
  surfaces: number;
  idle: number | undefined;
}

let shared: SharedPool | undefined;

/** A pool with no surface is on its idle clock from the moment it exists. */
function sharedPool(): WorkerPoolManager {
  if (shared === undefined) {
    const entry: SharedPool = {
      pool: new WorkerPoolManager(poolOptions, highlighterOptions),
      surfaces: 0,
      idle: undefined,
    };

    entry.idle = window.setTimeout(() => releaseIdle(entry), POOL_IDLE_MS);
    shared = entry;
  }

  return shared.pool;
}

function releaseIdle(entry: SharedPool): void {
  entry.idle = undefined;
  entry.pool.terminate();

  if (shared === entry) shared = undefined;
}

/** A mounted surface holds the pool; the last one to leave starts the idle clock. */
function retain(): () => void {
  const entry = shared;

  if (entry === undefined) return () => {};

  window.clearTimeout(entry.idle);
  entry.idle = undefined;
  entry.surfaces += 1;

  return () => {
    entry.surfaces -= 1;

    if (entry.surfaces === 0)
      entry.idle = window.setTimeout(() => releaseIdle(entry), POOL_IDLE_MS);
  };
}

/**
 * Wrap each Pierre surface. Every surface shares one pool, created by the
 * first and kept for a while after the last leaves, so scrolling a transcript
 * past its diffs or switching tabs never restarts the workers. Nothing runs
 * once the grace period passes with no diff or editor on screen.
 *
 * The subscription is the ownership: React subscribes on commit and
 * unsubscribes on unmount, and the pool never changes while a surface holds it.
 */
export function PierreWorkerProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const pool = useSyncExternalStore(retain, sharedPool, sharedPool);

  return <WorkerPoolContext value={pool}>{children}</WorkerPoolContext>;
}
