import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Button } from "@nyte-ai/ui/button";
import { loadDeferred } from "../deferred.tsx";
import { keys } from "../query-keys.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { codeBlockStyles } from "./prose.stylex.ts";

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

const highlightCache = new Map<string, HighlightedCode>();

let highlightCacheBytes = 0;

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

async function requestHighlight(code: string, language: string): Promise<HighlightResult> {
  const html = await loadDeferred("highlight").then(
    (runtime) => runtime.highlightCode(code, language),
    () => undefined,
  );

  if (html === undefined) return PLAIN_HIGHLIGHT;

  const value = { code, language, html };

  rememberHighlight(value);

  return { kind: "highlighted", value };
}

function HighlightedCode({
  code,
  language,
  nearViewport,
}: {
  code: string;
  language: string;
  nearViewport: boolean;
}): ReactElement {
  const cached = cachedHighlight(code, language);

  const { data } = useQuery({
    queryKey: keys.highlight(language, code),
    queryFn: () => requestHighlight(code, language),
    enabled: nearViewport && language !== "" && cached === undefined,
    gcTime: 0,
  });

  const html = data?.kind === "highlighted" ? data.value.html : cached?.html;

  return html === undefined ? (
    <code>{code}</code>
  ) : (
    <code dangerouslySetInnerHTML={{ __html: html }} />
  );
}

export function CodeBlock({
  code,
  lang,
  streaming = false,
}: {
  code: string;
  lang: string;
  streaming?: boolean;
}): ReactElement {
  const language = lang.trim().toLowerCase().split(/\s+/u)[0] ?? "";
  const figure = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string>();
  const copied = copiedCode === code;

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
    <figure ref={figure} {...props(codeBlockStyles.figure)}>
      <span {...props(codeBlockStyles.copy)}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                variant="outline"
                tone={copied ? "success" : "neutral"}
                iconOnly
                icon={copied ? "checkmark" : "copy"}
                data-copied={copied || undefined}
                aria-label={language === "" ? "Copy code block" : `Copy ${language} code block`}
                onClick={() => {
                  navigator.clipboard
                    .writeText(code)
                    .then(() => setCopiedCode(code))
                    .catch(() => undefined);
                }}
              />
            }
          />
          <TooltipContent>{copied ? "Copied" : "Copy code"}</TooltipContent>
        </Tooltip>
      </span>
      <div data-nyte-scrollport {...props(codeBlockStyles.scroll)}>
        <pre data-nyte-code {...props(text.code, codeBlockStyles.pre)}>
          {streaming ? (
            <code>{code}</code>
          ) : (
            <HighlightedCode code={code} language={language} nearViewport={nearViewport} />
          )}
        </pre>
      </div>
    </figure>
  );
}
