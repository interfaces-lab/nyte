import { props } from "@stylexjs/stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { Button } from "@nyte-ai/ui/button";
import { loadDeferred, readDeferred } from "../../lib/deferred.tsx";
import type { DeferredRuntimes } from "../../lib/deferred-entries.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { useCopyConfirmation } from "../../components/copy-confirmation.ts";
import { codeBlockStyles } from "./prose.stylex.ts";

interface HighlightedCode {
  readonly code: string;
  readonly language: string;
  readonly lines: readonly string[];
}

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
  return (
    (value.code.length +
      value.language.length +
      value.lines.reduce((total, line) => total + line.length, 0)) *
    2
  );
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

function highlightLines(
  runtime: DeferredRuntimes["highlight"],
  code: string,
  language: string,
  streaming: boolean,
): readonly string[] | undefined {
  if (streaming) return runtime.highlightOpenCode(code, language);

  const lines = runtime.highlightCode(code, language);

  if (lines !== undefined) rememberHighlight({ code, language, lines });

  return lines;
}

function HighlightedCode({
  code,
  language,
  nearViewport,
  streaming,
}: {
  code: string;
  language: string;
  nearViewport: boolean;
  streaming: boolean;
}): ReactElement {
  const cached = streaming ? undefined : cachedHighlight(code, language);

  const { data: runtime } = useQuery({
    queryKey: ["deferred", "highlight"],
    queryFn: () => loadDeferred("highlight"),
    initialData: () => readDeferred("highlight"),
    enabled: nearViewport && language !== "" && cached === undefined,
  });

  const lines =
    cached?.lines ??
    (nearViewport && runtime !== undefined
      ? highlightLines(runtime, code, language, streaming)
      : undefined);

  if (lines === undefined) return <code>{code}</code>;

  return (
    <code>
      {lines.map((html, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          <span dangerouslySetInnerHTML={{ __html: html }} />
        </Fragment>
      ))}
    </code>
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
  const confirmation = useCopyConfirmation();
  const copied = confirmation.copied;

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
                onClick={() => confirmation.copy(code)}
              />
            }
          />
          <TooltipContent>{copied ? "Copied" : "Copy code"}</TooltipContent>
        </Tooltip>
      </span>
      <div data-nyte-scrollport {...props(codeBlockStyles.scroll)}>
        <pre data-nyte-code {...props(text.code, codeBlockStyles.pre)}>
          <HighlightedCode
            code={code}
            language={language}
            nearViewport={nearViewport}
            streaming={streaming}
          />
        </pre>
      </div>
    </figure>
  );
}
