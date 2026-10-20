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

const POOL_SIZE = Math.max(2, Math.min(6, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

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

const POOL_IDLE_MS = 30_000;

const poolOptions = {
  workerFactory: () => new OnDemandWorker(),
  poolSize: POOL_SIZE,
  totalASTLRUCacheSize: 240,
} satisfies WorkerPoolOptions;

export const PIERRE_THEME = { light: "github-light", dark: "github-dark" } as const;

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

export function PierreWorkerProvider({ children }: { readonly children: ReactNode }): ReactElement {
  const pool = useSyncExternalStore(retain, sharedPool, sharedPool);

  return <WorkerPoolContext value={pool}>{children}</WorkerPoolContext>;
}
