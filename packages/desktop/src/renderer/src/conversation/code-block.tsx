import type { HighlightCancel, HighlightRequest } from "./syntax-highlighter.worker.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
// Fenced code paints as escaped plain text immediately. Known grammars upgrade
// in a bundled worker, keeping grammars and syntax work off the UI thread.
import * as stylex from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Icon } from "../components/icons.tsx";
import { focus, Hint } from "../components/ui.tsx";
import { keys } from "../query-keys.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { codeBlockStyles } from "./styles.stylex.ts";

const HIGHLIGHTABLE = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "c",
  "cpp",
  "c++",
  "cxx",
  "csharp",
  "cs",
  "css",
  "diff",
  "docker",
  "dockerfile",
  "go",
  "html",
  "htm",
  "java",
  "javascript",
  "js",
  "json",
  "jsonc",
  "jsx",
  "markdown",
  "md",
  "mdx",
  "php",
  "powershell",
  "ps1",
  "python",
  "py",
  "ruby",
  "rb",
  "rust",
  "rs",
  "sql",
  "toml",
  "tsx",
  "typescript",
  "ts",
  "xml",
  "yaml",
  "yml",
]);

interface HighlightedCode {
  readonly code: string;
  readonly language: string;
  readonly html: string;
}

type HighlightResult =
  | { readonly kind: "highlighted"; readonly value: HighlightedCode }
  | { readonly kind: "plain" };

const PLAIN_HIGHLIGHT = { kind: "plain" } as const;
const HIGHLIGHT_CACHE_MAX_BYTES = 8 * 1024 * 1024;
// Long enough to span ordinary reading pauses, short enough that grammars do
// not sit resident through an idle session.
const HIGHLIGHT_WORKER_IDLE_MS = 30 * 60 * 1000;
const highlightCache = new Map<string, HighlightedCode>();
const pendingHighlights = new Map<number, (html: string | undefined) => void>();
const highlightReply = Type.Object({
  id: Type.Number(),
  html: Type.Union([Type.String(), Type.Null()]),
});
let highlightCacheBytes = 0;
let worker: Worker | undefined;
let idleRelease: ReturnType<typeof setTimeout> | undefined;
let nextHighlightId = 0;

function clearIdleRelease(): void {
  if (idleRelease === undefined) return;
  clearTimeout(idleRelease);
  idleRelease = undefined;
}

function scheduleIdleRelease(): void {
  clearIdleRelease();
  if (worker === undefined || pendingHighlights.size > 0) return;
  idleRelease = setTimeout(() => {
    idleRelease = undefined;
    if (worker === undefined || pendingHighlights.size > 0) return;
    worker.terminate();
    worker = undefined;
  }, HIGHLIGHT_WORKER_IDLE_MS);
}

function finishHighlight(id: number, html: string | undefined): void {
  const notify = pendingHighlights.get(id);
  pendingHighlights.delete(id);
  notify?.(html);
  scheduleIdleRelease();
}

function cancelHighlight(id: number): void {
  if (!pendingHighlights.delete(id)) return;
  try {
    worker?.postMessage({ id, cancel: true } satisfies HighlightCancel);
  } catch {
    // The worker keeps the stale request; its reply finds no listener.
  }
  scheduleIdleRelease();
}

function failWorker(failed: Worker): void {
  if (worker !== failed) return;
  failed.terminate();
  worker = undefined;
  clearIdleRelease();
  const pending = [...pendingHighlights.values()];
  pendingHighlights.clear();
  for (const settle of pending) settle(undefined);
}

function enqueueHighlight(
  code: string,
  language: string,
  receive: (html: string | undefined) => void,
): number {
  clearIdleRelease();
  if (worker === undefined) {
    const created = new Worker(new URL("./syntax-highlighter.worker.ts", import.meta.url), {
      type: "module",
    });
    worker = created;
    created.onmessage = (event: MessageEvent<unknown>) => {
      try {
        const { id, html } = Value.Parse(highlightReply, event.data);
        finishHighlight(id, html ?? undefined);
      } catch {
        failWorker(created);
      }
    };
    created.onerror = () => failWorker(created);
    created.onmessageerror = () => failWorker(created);
  }
  const id = ++nextHighlightId;
  pendingHighlights.set(id, receive);
  try {
    worker.postMessage({ id, code, language } satisfies HighlightRequest);
  } catch {
    failWorker(worker);
  }
  return id;
}

function highlightKey(code: string, language: string): string {
  let hash = 2_166_136_261;
  for (const text of [language, code]) {
    for (let index = 0; index < text.length; index += 1) {
      hash = Math.imul(hash ^ text.charCodeAt(index), 16_777_619);
    }
    hash = Math.imul(hash ^ 0, 16_777_619);
  }
  return `${String(language.length)}:${String(code.length)}:${String(hash >>> 0)}`;
}

function cachedHighlight(code: string, language: string): HighlightedCode | undefined {
  const key = highlightKey(code, language);
  const cached = highlightCache.get(key);
  if (cached?.code !== code || cached.language !== language) return undefined;
  highlightCache.delete(key);
  highlightCache.set(key, cached);
  return cached;
}

function highlightBytes(value: HighlightedCode): number {
  return (value.code.length + value.language.length + value.html.length) * 2;
}

function rememberHighlight(value: HighlightedCode): void {
  const bytes = highlightBytes(value);
  if (bytes > HIGHLIGHT_CACHE_MAX_BYTES) return;
  const key = highlightKey(value.code, value.language);
  const previous = highlightCache.get(key);
  if (previous !== undefined) highlightCacheBytes -= highlightBytes(previous);
  highlightCache.delete(key);
  highlightCache.set(key, value);
  highlightCacheBytes += bytes;
  while (highlightCacheBytes > HIGHLIGHT_CACHE_MAX_BYTES) {
    const oldest = highlightCache.keys().next().value;
    if (oldest === undefined) break;
    const removed = highlightCache.get(oldest);
    highlightCache.delete(oldest);
    if (removed !== undefined) highlightCacheBytes -= highlightBytes(removed);
  }
}

// The reply also fills the module cache, so a remounted row paints from
// `cachedHighlight` instead of asking the worker again. Leaving early pulls
// the request out of both queues; nothing waits on a result nobody will show.
export function requestHighlight(
  code: string,
  language: string,
  signal: AbortSignal,
): Promise<HighlightResult> {
  if (signal.aborted) return Promise.resolve(PLAIN_HIGHLIGHT);
  return new Promise((resolve) => {
    let settled = false;
    const request = { id: 0, abort: (): void => {} };
    const settle = (html: string | undefined): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", request.abort);
      if (html === undefined) {
        resolve(PLAIN_HIGHLIGHT);
        return;
      }
      const value = { code, language, html };
      rememberHighlight(value);
      resolve({ kind: "highlighted", value });
    };
    request.abort = (): void => {
      cancelHighlight(request.id);
      settle(undefined);
    };
    signal.addEventListener("abort", request.abort, { once: true });
    try {
      request.id = enqueueHighlight(code, language, settle);
    } catch {
      settle(undefined);
    }
  });
}

export function CodeBlock({ code, lang }: { code: string; lang: string }): ReactElement {
  const language = lang.trim().toLowerCase().split(/\s+/u)[0] ?? "";
  const figure = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string>();
  const copied = copiedCode === code;
  const cached = cachedHighlight(code, language);
  const { data } = useQuery({
    queryKey: keys.highlight(language, code),
    queryFn: ({ signal }) => requestHighlight(code, language, signal),
    enabled: nearViewport && HIGHLIGHTABLE.has(language) && cached === undefined,
    staleTime: Infinity,
    gcTime: 0,
  });
  const html = data?.kind === "highlighted" ? data.value.html : cached?.html;

  useMountEffect(() => {
    const element = figure.current;
    if (element === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  return (
    <figure ref={figure} {...stylex.props(codeBlockStyles.figure)}>
      <Hint
        content={copied ? "Copied" : "Copy code"}
        trigger={
          <Button
            unstyled
            type="button"
            aria-label={copied ? "Code copied" : "Copy code"}
            onClick={() => {
              navigator.clipboard
                .writeText(code)
                .then(() => setCopiedCode(code))
                .catch(() => undefined);
            }}
            {...stylex.props(codeBlockStyles.copy, focus.ringInset)}
          >
            <Icon name={copied ? "checkmark" : "copy"} size={13} />
          </Button>
        }
      />
      <div data-nyte-scrollport {...stylex.props(codeBlockStyles.scroll)}>
        {html === undefined ? (
          <pre {...stylex.props(codeBlockStyles.pre)}>
            <code>{code}</code>
          </pre>
        ) : (
          <div
            {...stylex.props(codeBlockStyles.pre)}
            // Shiki output over escaped code; see module note.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </figure>
  );
}
