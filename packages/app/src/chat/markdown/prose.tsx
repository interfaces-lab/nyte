import { intent } from "@nyte-ai/ui/surface-theme";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { props } from "@stylexjs/stylex";
import {
  Children,
  createContext,
  Fragment,
  isValidElement,
  use,
  useSyncExternalStore,
} from "react";
import type { ComponentProps, ReactElement, ReactNode } from "react";
import remend from "remend";
import {
  defaultUrlTransform,
  parseMarkdownIntoBlocks,
  Streamdown,
  useIsCodeFenceIncomplete,
} from "streamdown";
import type { Components, ExtraProps, StreamdownProps, UrlTransform } from "streamdown";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import { openConversationLink } from "./external-link.ts";
import { useQuery } from "@tanstack/react-query";
import { mentionFilesOptions } from "../../data/files.ts";
import { useChatFolder } from "../chat-folder.ts";
import { CodeBlock } from "./code-block.tsx";
import { MermaidDiagram } from "./mermaid-diagram.tsx";
import { Icon } from "@nyte-ai/ui/icon";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { FileTypeIcon } from "../../components/file-type-icon.tsx";
import {
  fileFromUrl,
  inlineCodeReference,
  mentionsFolder,
  referenceTitle,
} from "../../references/message-references.ts";
import type { MessageReference } from "../../references/message-references.ts";
import type { MentionFile } from "../../data/files.ts";
import { asId } from "@nyte-ai/schema";
import { useReferenceOpener } from "../../references/reference-opener.tsx";
import { proseStyles } from "./prose.stylex.ts";
import { SubagentCitation } from "../tools/subagent-call.tsx";
import {
  FadeEnd,
  FadeSpan,
  FadingBlock,
  findStreamingTail,
  ReducedMotion,
  StreamingTail,
} from "../transcript/chunk-fade.tsx";

const textNode = Type.Union([Type.String(), Type.Number(), Type.BigInt()]);

function nodeText(node: ReactNode): string {
  if (Value.Check(textNode, node)) return String(node);

  if (Array.isArray(node)) return node.map(nodeText).join("");

  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);

  return "";
}

const AGENT_LINK = "agent:";

const InsideLink = createContext(false);

const NO_FILES: readonly MentionFile[] = [];

const CitableFiles = createContext(NO_FILES);

export function useCitableFiles(enabled: boolean) {
  return useQuery({
    ...mentionFilesOptions(useChatFolder(), enabled),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

function FileCitation({
  reference,
  open,
  label,
  code,
  ...elementProps
}: Omit<ComponentProps<"a">, "href" | "onClick" | "children"> & {
  readonly reference: Extract<MessageReference, { kind: "file" }>;
  readonly open: () => void;
  readonly label: string;
  readonly code: boolean;
}): ReactElement {
  const [lead = "", ...segments] = label.split(/(?<=\/)(?=.)/u);

  const text = (content: ReactNode): ReactNode =>
    code ? <code {...props(proseStyles.inlineCode)}>{content}</code> : content;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            {...elementProps}
            href={reference.file.url}
            data-citation={mentionsFolder(reference.file) ? "folder" : "file"}
            {...props(intent.primary, proseStyles.link)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              open();
            }}
          >
            <span {...props(proseStyles.linkLead)}>
              <span aria-hidden="true" {...props(proseStyles.linkIcon)}>
                {mentionsFolder(reference.file) ? (
                  <Icon name="folder" size="xs" />
                ) : (
                  <FileTypeIcon path={reference.file.path} />
                )}
              </span>
              {text(lead)}
            </span>
            {segments.length > 0 &&
              text(
                segments.map((segment, index) => (
                  <Fragment key={index}>
                    <wbr />
                    {segment}
                  </Fragment>
                )),
              )}
          </a>
        }
      />
      <TooltipContent side="top">{referenceTitle(reference)}</TooltipContent>
    </Tooltip>
  );
}

function MarkdownCode({
  node: _node,
  className: _className,
  ...elementProps
}: ComponentProps<"code"> & ExtraProps): ReactElement {
  const insideLink = use(InsideLink);
  const referenceOpener = useReferenceOpener();
  const opener = insideLink ? undefined : referenceOpener;
  const files = use(CitableFiles);

  const text = nodeText(elementProps.children);
  const reference = opener === undefined ? undefined : inlineCodeReference(text, files);

  const open = reference === undefined ? undefined : opener?.(reference);

  if (reference?.kind !== "file" || open === undefined) {
    return <code {...elementProps} {...props(proseStyles.inlineCode)} />;
  }

  return <FileCitation reference={reference} open={open} label={text} code />;
}

export function linkReference(
  href: string,
  files: readonly MentionFile[],
): MessageReference | undefined {
  if (/^[a-z][a-z\d+-]*:/iu.test(href) && !href.startsWith("file:")) return undefined;

  if (href.startsWith("file:")) {
    const file = fileFromUrl(href);

    return file === undefined ? undefined : { kind: "file", file };
  }

  if (href.startsWith("/")) {
    const url = new URL("file:///");
    url.pathname = href.replace(/[#:].*$/u, "");
    const file = fileFromUrl(url.href);

    return file === undefined ? undefined : { kind: "file", file };
  }

  return inlineCodeReference(safeDecode(href), files);
}

function safeDecode(text: string): string {
  try {
    return decodeURI(text);
  } catch {
    return text;
  }
}

function MarkdownLink({
  node: _node,
  className: _className,
  onClick: _onClick,
  title: _title,
  href,
  children,
  ...elementProps
}: ComponentProps<"a"> & ExtraProps): ReactElement {
  const opener = useReferenceOpener();
  const files = use(CitableFiles);

  if (href?.startsWith(AGENT_LINK) === true) {
    const agent = href.slice(AGENT_LINK.length);

    return agent === "" ? (
      <>{children}</>
    ) : (
      <SubagentCitation session={asId<"session">(agent)} label={nodeText(children)} />
    );
  }

  const reference =
    opener === undefined || href === undefined ? undefined : linkReference(href, files);

  const open = reference === undefined ? undefined : opener?.(reference);

  if (reference?.kind === "file" && open !== undefined) {
    return (
      <FileCitation
        {...elementProps}
        reference={reference}
        open={open}
        label={nodeText(children)}
        code={Children.toArray(children).every(
          (child) => isValidElement(child) && child.type === MarkdownCode,
        )}
      />
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            {...elementProps}
            href={href}
            {...props(intent.primary, proseStyles.link, proseStyles.webLink)}
            onClick={(event) => {
              if (href === undefined) return;
              event.preventDefault();
              openConversationLink(href, opener);
            }}
          >
            <InsideLink value>{children}</InsideLink>
          </a>
        }
      />
      <TooltipContent>{href}</TooltipContent>
    </Tooltip>
  );
}

function MarkdownPre({
  children,
  className: _className,
  node: _node,
  ...elementProps
}: ComponentProps<"pre"> & ExtraProps): ReactElement {
  const open = useIsCodeFenceIncomplete();
  const child = Children.toArray(children)[0];

  if (Children.count(children) === 1 && isValidElement<ComponentProps<"code">>(child)) {
    const raw = nodeText(child.props.children);
    const code = raw.endsWith("\n") ? raw.slice(0, -1) : raw;

    const language =
      child.props.className
        ?.split(/\s+/u)
        .find((name) => name.startsWith("language-"))
        ?.slice("language-".length) ?? "";

    if (!open && language.toLocaleLowerCase() === "mermaid")
      return <MermaidDiagram source={code} />;

    return <CodeBlock code={code} lang={language} streaming={open} />;
  }

  return (
    <pre {...elementProps} data-nyte-scrollport {...props(proseStyles.fallbackPre)}>
      {children}
    </pre>
  );
}

function MarkdownRule({
  node,
  className: _className,
  ...elementProps
}: ComponentProps<"hr"> & ExtraProps): ReactElement {
  const settle = use(FadeEnd);

  return (
    <hr
      {...elementProps}
      onAnimationEnd={() => settle?.(node)}
      {...props(
        proseStyles.rule,
        node?.properties["data-sd-animate"] === true && proseStyles.chunk,
      )}
    />
  );
}

function MarkdownImage({ node, alt, style }: ComponentProps<"img"> & ExtraProps): ReactElement {
  const fades = node?.properties["data-sd-animate"] === true;
  const settle = use(FadeEnd);

  return (
    <span
      data-sd-animate={fades || undefined}
      style={style}
      onAnimationEnd={() => settle?.(node)}
      {...props(proseStyles.imageLabel, fades && proseStyles.chunk)}
    >
      {alt ?? "image"}
    </span>
  );
}

const markdownComponents = {
  p: ({ node: _node, className: _className, ...elementProps }) => (
    <p {...elementProps} {...props(proseStyles.paragraph)} />
  ),
  h1: ({ node: _node, className: _className, ...elementProps }) => (
    <h1 {...elementProps} {...props(proseStyles.heading, proseStyles.h1)} />
  ),
  h2: ({ node: _node, className: _className, ...elementProps }) => (
    <h2 {...elementProps} {...props(proseStyles.heading, proseStyles.h2)} />
  ),
  h3: ({ node: _node, className: _className, ...elementProps }) => (
    <h3 {...elementProps} {...props(proseStyles.heading, proseStyles.h3)} />
  ),
  h4: ({ node: _node, className: _className, ...elementProps }) => (
    <h4 {...elementProps} {...props(proseStyles.heading, proseStyles.h4)} />
  ),
  h5: ({ node: _node, className: _className, ...elementProps }) => (
    <h5 {...elementProps} {...props(proseStyles.heading, proseStyles.h5)} />
  ),
  h6: ({ node: _node, className: _className, ...elementProps }) => (
    <h6 {...elementProps} {...props(proseStyles.heading, proseStyles.h6)} />
  ),
  strong: ({ node: _node, className: _className, ...elementProps }) => (
    <strong {...elementProps} {...props(proseStyles.strong)} />
  ),
  code: MarkdownCode,
  a: MarkdownLink,
  ul: ({ node: _node, className: _className, ...elementProps }) => (
    <ul {...elementProps} {...props(proseStyles.list)} />
  ),
  ol: ({ node: _node, className: _className, ...elementProps }) => (
    <ol {...elementProps} {...props(proseStyles.list)} />
  ),
  li: ({ node: _node, className: _className, ...elementProps }) => (
    <li {...elementProps} {...props(proseStyles.listItem)} />
  ),
  blockquote: ({ node: _node, className: _className, ...elementProps }) => (
    <blockquote {...elementProps} {...props(proseStyles.blockquote)} />
  ),
  hr: MarkdownRule,
  pre: MarkdownPre,
  table: ({ node: _node, className: _className, ...elementProps }) => (
    <div data-nyte-scrollport data-prose-table {...props(proseStyles.tableWrap, hairline.ring)}>
      <table {...elementProps} {...props(proseStyles.table)} />
    </div>
  ),
  th: ({ node: _node, className: _className, ...elementProps }) => (
    <th {...elementProps} {...props(proseStyles.cell, hairline.tableRow, proseStyles.headerCell)} />
  ),
  td: ({ node: _node, className: _className, ...elementProps }) => (
    <td {...elementProps} {...props(proseStyles.cell, hairline.tableRow)} />
  ),
  img: MarkdownImage,
  span: FadeSpan,
} satisfies Components;

const rehypePlugins: NonNullable<StreamdownProps["rehypePlugins"]> = [];

const urlTransform: UrlTransform = (url, key, node) =>
  url.startsWith(AGENT_LINK) ? url : defaultUrlTransform(url, key, node);

const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Completes unfinished syntax in the last block only, where the split keeps an unclosed fence, list
 * or math block, instead of Streamdown's pass over the whole answer on every update. The tail comes
 * from the source because marked rewrites trailing whitespace in a block's text, and remend reads
 * it. The split drops `\r` before measuring blocks, so the source drops it too.
 */
function splitMarkdown(markdown: string): string[] {
  const source = markdown.includes("\r") ? markdown.replaceAll(/\r\n?/gu, "\n") : markdown;
  const blocks = parseMarkdownIntoBlocks(source);

  if (blocks.length === 0) return blocks;

  const settled = blocks.slice(0, -1);

  return [
    ...settled,
    remend(source.slice(settled.reduce((length, block) => length + block.length, 0))),
  ];
}

function subscribeReducedMotion(onChange: () => void): () => void {
  reducedMotionQuery.addEventListener("change", onChange);

  return () => reducedMotionQuery.removeEventListener("change", onChange);
}

export function Prose({
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

  const files = useCitableFiles(useReferenceOpener() !== undefined);
  const blocks = splitMarkdown(markdown);

  return (
    <div {...props(proseStyles.root)}>
      <ReducedMotion value={reducedMotion}>
        <StreamingTail value={streaming ? findStreamingTail(markdown, blocks) : -1}>
          <CitableFiles value={files.data ?? NO_FILES}>
            <Streamdown
              isAnimating={streaming}
              parseIncompleteMarkdown={false}
              parseMarkdownIntoBlocksFn={(source) =>
                source === markdown ? blocks : splitMarkdown(source)
              }
              BlockComponent={FadingBlock}
              components={markdownComponents}
              rehypePlugins={rehypePlugins}
              urlTransform={urlTransform}
              skipHtml
            >
              {markdown}
            </Streamdown>
          </CitableFiles>
        </StreamingTail>
      </ReducedMotion>
    </div>
  );
}
