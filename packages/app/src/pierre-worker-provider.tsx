import { role } from "@nyte-ai/ui/styles/vars.stylex";
import type { ThemedFileResult } from "@pierre/diffs";
import { WorkerPoolContext } from "@pierre/diffs/react";
import { WorkerPoolManager } from "@pierre/diffs/worker";
import type {
  WorkerInitializationRenderOptions,
  WorkerPoolOptions,
  WorkerRequest,
  WorkerResponse,
} from "@pierre/diffs/worker";
import PierreDiffWorkerUrl from "@pierre/diffs/worker/worker-portable.js?url";
import { useSyncExternalStore } from "react";
import type { ReactElement, ReactNode } from "react";
import { bundledLanguages } from "shiki";

/**
 * At most half the cores, within reason: highlighting shares the machine with
 * the agent. Slots start their workers only under load; see `OnDemandWorker`.
 */
const POOL_SIZE = Math.max(2, Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

/**
 * One pool slot, whose worker starts with the slot's first render request.
 * Pierre's pool creates every slot up front and waits for each to initialize,
 * so a slot without a worker answers setup requests itself and replays them,
 * in order, to each worker it starts; the worker's successful answers to
 * those are dropped. A replayed request that fails means the worker cannot
 * render: the render in flight fails with that error, and the next render
 * starts a new worker. The pool hands a task to its first idle slot, so a
 * second worker starts only while the first is busy: one diff costs one
 * worker, and a review of many grows the pool up to `POOL_SIZE`.
 */
class OnDemandWorker extends EventTarget implements Worker {
  onmessage: ((this: Worker, event: MessageEvent<WorkerResponse>) => void) | null = null;

  onmessageerror: ((this: Worker, event: MessageEvent) => void) | null = null;

  onerror: ((this: AbstractWorker, event: ErrorEvent) => void) | null = null;

  #worker: Worker | undefined;

  readonly #setup: WorkerRequest[] = [];

  readonly #replayed = new Set<string>();

  #rendering: string | undefined;

  postMessage(request: WorkerRequest): void {
    const render = request.type === "file" || request.type === "diff";

    if (render) this.#rendering = request.id;
    else this.#setup.push(request);

    if (this.#worker !== undefined) {
      this.#worker.postMessage(request);

      return;
    }

    if (render) {
      this.#start().postMessage(request);

      return;
    }

    queueMicrotask(() =>
      this.#deliver({
        type: "success",
        requestType: request.type,
        id: request.id,
        sentAt: Date.now(),
      }),
    );
  }

  terminate(): void {
    this.#worker?.terminate();
    this.#worker = undefined;
  }

  #start(): Worker {
    const worker = new Worker(PierreDiffWorkerUrl, { type: "module" });

    worker.addEventListener("message", (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      if (!this.#replayed.delete(response.id)) {
        if (response.id === this.#rendering) this.#rendering = undefined;
        this.#deliver(response);

        return;
      }

      if (response.type !== "error" || this.#worker !== worker) return;
      worker.terminate();
      this.#worker = undefined;
      this.#replayed.clear();
      const rendering = this.#rendering;
      this.#rendering = undefined;

      if (rendering !== undefined) this.#deliver({ ...response, id: rendering });
    });

    worker.addEventListener("error", (event) => {
      const copy = new ErrorEvent("error", { message: event.message, error: event.error });

      this.dispatchEvent(copy);
      this.onerror?.call(this, copy);
    });

    for (const request of this.#setup) {
      this.#replayed.add(request.id);
      worker.postMessage(request);
    }

    this.#worker = worker;

    return worker;
  }

  #deliver(data: WorkerResponse): void {
    const event = new MessageEvent("message", { data });

    this.dispatchEvent(event);
    this.onmessage?.call(this, event);
  }
}

/**
 * How long a pool outlives its last surface. A transcript scrolling past its
 * diffs, or a tab switch, must not spawn workers and reload grammars again.
 */
const POOL_IDLE_MS = 30_000;

/**
 * The cache keeps 240 highlights per file and per diff: enough that a review's
 * every file stays warm while it scrolls in and out of the viewport.
 */
const poolOptions = {
  workerFactory: () => new OnDemandWorker(),
  poolSize: POOL_SIZE,
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

type HighlightNode = ThemedFileResult["code"][number];

const HTML_ESCAPES = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
]);

function escapeHtml(text: string): string {
  return text.replaceAll(/[&<>"]/gu, (character) => HTML_ESCAPES.get(character) ?? character);
}

/** A line's tokens as HTML: each token a span carrying its `--diffs-token-*` colours. */
function tokenHtml(node: HighlightNode): string {
  if (node.type === "text") return escapeHtml(node.value);

  if (node.type !== "element") return "";

  const children = node.children.map(tokenHtml).join("");

  if (node.tagName !== "span") return children;

  const style = node.properties.style;

  return style === undefined || style === null
    ? `<span>${children}</span>`
    : `<span style="${escapeHtml(String(style))}">${children}</span>`;
}

/**
 * A fenced code block's lines as HTML, highlighted by the pool the diffs and
 * the editor use: one tokenizer, one theme pair and one set of grammars for
 * every highlight in the window. Each line is a `div` in Pierre's output; here
 * lines are joined with newlines for a `pre`, and every text node is escaped.
 * Undefined when shiki has no grammar for the fence's language or the pool
 * fails, and the block stays plain.
 */
export async function highlightCode(
  code: string,
  language: string,
  cacheKey: string,
): Promise<string | undefined> {
  if (!Object.hasOwn(bundledLanguages, language)) return undefined;

  const pool = sharedPool();
  const release = retain();
  const file = { name: "code-block", contents: code, lang: language, cacheKey: `code:${cacheKey}` };

  try {
    await pool.primeFileHighlightCache(file);

    return pool
      .getFileResultCache(file)
      ?.result.code.map((line) => {
        const html = tokenHtml(line);

        return html === "\n" ? "" : html;
      })
      .join("\n");
  } catch {
    return undefined;
  } finally {
    release();
  }
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
