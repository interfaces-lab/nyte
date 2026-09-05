import type { HighlightRequest } from "./syntax-highlighter.worker.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
// Fenced code paints as escaped plain text immediately. Known grammars upgrade
// in a bundled worker, keeping grammars and syntax work off the UI thread.
import * as stylex from "@stylexjs/stylex";
import { Button } from "@nyte-ai/ui";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Icon } from "../components/icons.tsx";
import { focus } from "../components/ui.tsx";
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

const HIGHLIGHT_CACHE_LIMIT = 64;
const highlightCache = new Map<string, HighlightedCode>();
const pendingHighlights = new Map<number, (html: string) => void>();
const highlightReply = Type.Object({
  id: Type.Number(),
  html: Type.Union([Type.String(), Type.Null()]),
});
let worker: Worker | undefined;
let nextHighlightId = 0;

function enqueueHighlight(
  code: string,
  language: string,
  receive: (html: string) => void,
): () => void {
  if (worker === undefined) {
    worker = new Worker(new URL("./syntax-highlighter.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const { id, html } = Value.Parse(highlightReply, event.data);
      const notify = pendingHighlights.get(id);
      pendingHighlights.delete(id);
      if (html !== null) notify?.(html);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = undefined;
      pendingHighlights.clear();
    };
  }
  const id = ++nextHighlightId;
  pendingHighlights.set(id, receive);
  worker.postMessage({ id, code, language } satisfies HighlightRequest);
  return () => {
    pendingHighlights.delete(id);
  };
}

function cachedHighlight(code: string, language: string): HighlightedCode | undefined {
  const key = `${String(language.length)}:${language}${code}`;
  return highlightCache.get(key);
}

function rememberHighlight(value: HighlightedCode): void {
  const key = `${String(value.language.length)}:${value.language}${value.code}`;
  highlightCache.delete(key);
  highlightCache.set(key, value);
  if (highlightCache.size > HIGHLIGHT_CACHE_LIMIT) {
    const oldest = highlightCache.keys().next().value;
    if (oldest !== undefined) highlightCache.delete(oldest);
  }
}

export function CodeBlock({ code, lang }: { code: string; lang: string }): ReactElement {
  const language = lang.trim().toLowerCase().split(/\s+/u)[0] ?? "";
  const figure = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [highlighted, setHighlighted] = useState<HighlightedCode | undefined>(() =>
    cachedHighlight(code, language),
  );
  const [copiedCode, setCopiedCode] = useState<string>();
  const copied = copiedCode === code;
  const cached = cachedHighlight(code, language);
  const html =
    highlighted?.code === code && highlighted.language === language
      ? highlighted.html
      : cached?.html;

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    if (!nearViewport || !HIGHLIGHTABLE.has(language)) return;
    if (cachedHighlight(code, language) !== undefined) return;
    return enqueueHighlight(code, language, (html) => {
      const value = { code, language, html };
      rememberHighlight(value);
      setHighlighted(value);
    });
  }, [code, language, nearViewport]);

  return (
    <figure ref={figure} {...stylex.props(codeBlockStyles.figure)}>
      <div {...stylex.props(codeBlockStyles.toolbar)}>
        <span {...stylex.props(codeBlockStyles.language)}>
          {language === "" ? "code" : language}
        </span>
        <Button
          unstyled
          type="button"
          aria-label={copied ? "Code copied" : "Copy code"}
          title={copied ? "Copied" : "Copy code"}
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
      </div>
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
