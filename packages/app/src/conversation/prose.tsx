/**
 * LobeHub Streamdown renders Markdown with raw HTML disabled. Nyte supplies the
 * semantic components so links still cross the desktop host boundary and
 * fenced code paints immediately and highlights in a worker.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import { props } from "@stylexjs/stylex";
import { Children, isValidElement, memo, useSyncExternalStore } from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import { CachedMarkdown, Streamdown } from "@lobehub/streamdown";
import type { Components, ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import remend from "remend";
import { Hint } from "@nyte-ai/ui/tooltip";
import { openConversationLink } from "./link-preference.ts";
import { useMentionFiles } from "../queries.ts";
import { CodeBlock } from "./code-block.tsx";
import { ComposerChipView } from "./composer-chip.tsx";
import { MermaidDiagram } from "./mermaid-diagram.tsx";
import { inlineCodeReference } from "./message-references.ts";
import { useReferenceOpener } from "./reference-opener.tsx";
import { proseStyles } from "./styles.stylex.ts";

const textNode = Type.Union([Type.String(), Type.Number(), Type.BigInt()]);

function nodeText(node: ReactNode): string {
  if (Value.Check(textNode, node)) return String(node);

  if (Array.isArray(node)) return node.map(nodeText).join("");

  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);

  return "";
}

/**
 * Inline code the workspace can resolve draws as the chip a mention would,
 * so a path the model names opens where a path the reader typed opens. The
 * file list is the composer's own query; a surface with no opener never asks
 * for it and every span stays literal.
 */
function MarkdownCode({
  node: _node,
  className: _className,
  ...elementProps
}: ComponentProps<"code"> & ExtraProps): ReactElement {
  const openable = useReferenceOpener() !== undefined;
  const files = useMentionFiles(openable);

  const reference = openable
    ? inlineCodeReference(nodeText(elementProps.children), files.data ?? [])
    : undefined;

  if (reference === undefined) return <code {...elementProps} {...props(proseStyles.inlineCode)} />;

  return <ComposerChipView reference={reference} />;
}

function MarkdownLink({
  node: _node,
  className: _className,
  onClick: _onClick,
  title: _title,
  href,
  ...elementProps
}: ComponentProps<"a"> & ExtraProps): ReactElement {
  const opener = useReferenceOpener();

  return (
    <Hint
      content={href}
      trigger={
        <a
          {...elementProps}
          href={href}
          {...props(proseStyles.link)}
          onClick={(event) => {
            if (href === undefined) return;
            event.preventDefault();
            openConversationLink(href, opener);
          }}
        />
      }
    />
  );
}

function MarkdownPre({
  children,
  className: _className,
  node: _node,
  ...elementProps
}: ComponentProps<"pre"> & ExtraProps): ReactElement {
  const child = Children.toArray(children)[0];

  if (Children.count(children) === 1 && isValidElement<ComponentProps<"code">>(child)) {
    const raw = nodeText(child.props.children);
    const code = raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    const language =
      child.props.className
        ?.split(/\s+/u)
        .find((name) => name.startsWith("language-"))
        ?.slice("language-".length) ?? "";

    if (language.toLocaleLowerCase() === "mermaid") return <MermaidDiagram source={code} />;

    return <CodeBlock code={code} lang={language} />;
  }

  return (
    <pre {...elementProps} data-nyte-scrollport {...props(proseStyles.fallbackPre)}>
      {children}
    </pre>
  );
}

const markdownComponents = {
  p: ({ node: _node, className: _className, ...elementProps }) => (
    <p {...elementProps} {...props(proseStyles.measure, proseStyles.paragraph)} />
  ),
  h1: ({ node: _node, className: _className, ...elementProps }) => (
    <h1 {...elementProps} {...props(proseStyles.measure, proseStyles.heading, proseStyles.h1)} />
  ),
  h2: ({ node: _node, className: _className, ...elementProps }) => (
    <h2 {...elementProps} {...props(proseStyles.measure, proseStyles.heading, proseStyles.h2)} />
  ),
  h3: ({ node: _node, className: _className, ...elementProps }) => (
    <h3 {...elementProps} {...props(proseStyles.measure, proseStyles.heading, proseStyles.h3)} />
  ),
  h4: ({ node: _node, className: _className, ...elementProps }) => (
    <h4 {...elementProps} {...props(proseStyles.measure, proseStyles.heading, proseStyles.h4)} />
  ),
  h5: ({ node: _node, className: _className, ...elementProps }) => (
    <h5 {...elementProps} {...props(proseStyles.measure, proseStyles.heading, proseStyles.h5)} />
  ),
  h6: ({ node: _node, className: _className, ...elementProps }) => (
    <h6 {...elementProps} {...props(proseStyles.measure, proseStyles.heading, proseStyles.h6)} />
  ),
  strong: ({ node: _node, className: _className, ...elementProps }) => (
    <strong {...elementProps} {...props(proseStyles.strong)} />
  ),
  code: MarkdownCode,
  a: MarkdownLink,
  ul: ({ node: _node, className: _className, ...elementProps }) => (
    <ul {...elementProps} {...props(proseStyles.measure, proseStyles.list)} />
  ),
  ol: ({ node: _node, className: _className, ...elementProps }) => (
    <ol {...elementProps} {...props(proseStyles.measure, proseStyles.list)} />
  ),
  li: ({ node: _node, className: _className, ...elementProps }) => (
    <li {...elementProps} {...props(proseStyles.listItem)} />
  ),
  blockquote: ({ node: _node, className: _className, ...elementProps }) => (
    <blockquote {...elementProps} {...props(proseStyles.measure, proseStyles.blockquote)} />
  ),
  hr: ({ node: _node, className: _className, ...elementProps }) => (
    <hr {...elementProps} {...props(proseStyles.rule)} />
  ),
  pre: MarkdownPre,
  table: ({ node: _node, className: _className, ...elementProps }) => (
    <div data-nyte-scrollport data-prose-table {...props(proseStyles.tableWrap)}>
      <table {...elementProps} {...props(proseStyles.table)} />
    </div>
  ),
  th: ({ node: _node, className: _className, ...elementProps }) => (
    <th {...elementProps} {...props(proseStyles.cell, proseStyles.headerCell)} />
  ),
  td: ({ node: _node, className: _className, ...elementProps }) => (
    <td {...elementProps} {...props(proseStyles.cell)} />
  ),
  img: ({ node: _node, className: _className, alt, title: _title, ..._props }) => (
    <span {...props(proseStyles.imageLabel)}>{alt ?? "image"}</span>
  ),
} satisfies Components;

const remarkPlugins = [remarkGfm];

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

function subscribeReducedMotion(onChange: () => void): () => void {
  reducedMotionQuery.addEventListener("change", onChange);

  return () => reducedMotionQuery.removeEventListener("change", onChange);
}

export const Prose = memo(function Prose({
  markdown,
  streaming = false,
}: {
  markdown: string;
  streaming?: boolean;
}): ReactElement {
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => reducedMotionQuery.matches,
    () => true,
  );

  return (
    <div {...props(proseStyles.root)}>
      {streaming && !reducedMotion ? (
        <Streamdown
          content={markdown}
          components={markdownComponents}
          remarkPlugins={remarkPlugins}
          skipHtml
        />
      ) : (
        // Whole-document parsing preserves reference links and footnotes in saved turns.
        <CachedMarkdown components={markdownComponents} remarkPlugins={remarkPlugins} skipHtml>
          {streaming ? remend(markdown) : markdown}
        </CachedMarkdown>
      )}
    </div>
  );
});
