import "@nyte-ai/ui/words/styles.css";
import { asId } from "@nyte-ai/schema";
import type { ByteReader, WorkspaceId } from "@nyte-ai/sdk";
import { FileTypeIcon } from "@nyte-ai/ui/file-type-icon";
import { Icon } from "@nyte-ai/ui/icon";
import { intent } from "@nyte-ai/ui/surface-theme";
import { Tooltip, TooltipContent, tooltipTiming } from "@nyte-ai/ui/tooltip";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { defaultUrlTransform, Markdown } from "@nyte-ai/ui/words/react";
import type { Components } from "@nyte-ai/ui/words/react";
import { props } from "@stylexjs/stylex";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { filesFor, mentionFilesOptions } from "../data/files.ts";
import type { MentionFile } from "../data/files.ts";
import { blobUrlQuery } from "../lib/use-blob-url.ts";
import {
  fileFromUrl,
  inlineCodeReference,
  referenceTitle,
} from "../references/message-references.ts";
import type { MessageReference } from "../references/message-references.ts";
import { useReferenceOpener } from "../references/reference-opener.tsx";
import type { ReferenceOpener } from "../references/reference-opener.tsx";
import { useChatFolder } from "../chats/index.ts";
import { ImageViewer } from "../images/image-viewer.tsx";
import { SubagentCitation } from "../chat/tools/subagent-call.tsx";
import { openConversationLink } from "./external-link.ts";
import { CodeBlock } from "./code-block.tsx";
import { MarkdownTable } from "./markdown-table.tsx";
import type { MarkdownCell, MarkdownRow } from "./markdown-table.tsx";
import { MermaidDiagram } from "./mermaid-diagram.tsx";
import { codeBlockStyles, proseStyles } from "./prose.stylex.ts";

const AGENT_LINK = "agent:";

const NO_FILES: readonly MentionFile[] = [];

export function useCitableFiles(enabled: boolean) {
  return useQuery({
    ...mentionFilesOptions(useChatFolder(), enabled),
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
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

function styled(tag: string, style: { readonly className?: string }): (html: string) => string {
  const attribute = ` class="${style.className ?? ""}"`;

  return (html) => `<${tag}${attribute}${html.slice(tag.length + 1)}`;
}

const tableHostClass = props(proseStyles.tableHost).className ?? "";

const slotClass = props(codeBlockStyles.slot).className ?? "";

const citedCodeClasses = (props(intent.primary, proseStyles.link).className ?? "")
  .split(" ")
  .filter((name) => name !== "");

const iconClass = props(proseStyles.linkIcon).className ?? "";

const CODE_BLOCK = '<div data-markdown="code-block"';

const ISLAND = "[data-nyte-island]";

const OPAQUE_ISLAND = '[data-nyte-island]:not([data-nyte-island="table"])';

const URL_SCHEME = /^[a-z][a-z\d+.-]*:/iu;

const components = {
  p: styled("p", props(proseStyles.paragraph)),
  h1: styled("h1", props(proseStyles.heading, proseStyles.h1)),
  h2: styled("h2", props(proseStyles.heading, proseStyles.h2)),
  h3: styled("h3", props(proseStyles.heading, proseStyles.h3)),
  h4: styled("h4", props(proseStyles.heading, proseStyles.h4)),
  h5: styled("h5", props(proseStyles.heading, proseStyles.h5)),
  h6: styled("h6", props(proseStyles.heading, proseStyles.h6)),
  strong: styled("strong", props(proseStyles.strong)),
  inlineCode: styled("code", props(proseStyles.inlineCode)),
  a: agentIsland,
  ul: styled("ul", props(proseStyles.list)),
  ol: styled("ol", props(proseStyles.list)),
  li: styled("li", props(proseStyles.listItem)),
  input: styled("input", props(proseStyles.taskCheckbox)),
  blockquote: styled("blockquote", props(proseStyles.blockquote)),
  hr: styled("hr", props(proseStyles.rule)),
  div: codeBlockIsland,
  img: imageIsland,
  // WARNING: keep `table` last. Words applies components in order, so its cells arrive styled.
  table: tableIsland,
} satisfies Components;

const webLink = styled("a", props(intent.primary, proseStyles.link, proseStyles.webLink));

const urlTransform = (url: string): string | null | undefined =>
  url.startsWith(AGENT_LINK)
    ? `#${url}`
    : defaultUrlTransform(url.startsWith("file:") ? filePath(url) : url);

function filePath(url: string): string {
  const parsed = URL.parse(url);

  return parsed === null ? "" : `${parsed.pathname}${parsed.hash}`;
}

export function Prose({
  markdown,
  streaming = false,
}: {
  markdown: string;
  streaming?: boolean;
}): ReactElement {
  const opener = useReferenceOpener();
  const files = useCitableFiles(opener !== undefined).data ?? NO_FILES;
  const [islands, setIslands] = useState<readonly MountedIsland[]>([]);
  const [watcher] = useState(() => watchIslands(setIslands));
  const [tip, setTip] = useState<Tip>();
  const timer = useRef<number | undefined>(undefined);
  const closedAt = useRef(0);

  useMountEffect(() => () => window.clearTimeout(timer.current));

  const schedule = (next: Tip | undefined, delay: number): void => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (next === undefined) closedAt.current = performance.now();
      setTip(next);
    }, delay);
  };

  const enter = (target: EventTarget): void => {
    const next = tipFor(target);

    if (next === undefined || next.anchor === tip?.anchor) return;

    const recent =
      tip !== undefined || performance.now() - closedAt.current < tooltipTiming.timeout;

    schedule(next, recent ? 0 : tooltipTiming.delay);
  };

  const leave = (target: EventTarget, related: EventTarget | null): void => {
    const anchor = tipFor(target)?.anchor;

    if (anchor === undefined || (related instanceof Node && anchor.contains(related))) return;
    schedule(undefined, tooltipTiming.closeDelay);
  };

  return (
    // oxlint-disable-next-line nyte-interactions/no-clickable-non-control -- delegates clicks from the native links and file paths that Words renders inside
    <div
      ref={(element) => (element === null ? undefined : watcher.attach(element, files))}
      {...props(proseStyles.root)}
      onClick={(event) => {
        const action = clickAction(event.target, opener, files);

        if (action === undefined) return;
        event.preventDefault();
        action();
      }}
      onPointerOver={(event) => enter(event.target)}
      onPointerOut={(event) => leave(event.target, event.relatedTarget)}
      onFocus={(event) => enter(event.target)}
      onBlur={(event) => leave(event.target, event.relatedTarget)}
    >
      <Markdown
        isAnimating={streaming}
        animated
        components={components}
        controls={false}
        lineNumbers={false}
        urlTransform={urlTransform}
      >
        {markdown}
      </Markdown>
      {islands.map((mounted) =>
        createPortal(<IslandContent island={mounted.island} />, mounted.container, mounted.key),
      )}
      <Tooltip
        open={tip !== undefined}
        onOpenChange={(open, details) => {
          if (!open && details.reason === "escape-key") setTip(undefined);
        }}
      >
        {tip !== undefined && (
          <TooltipContent anchor={tip.anchor} side={tip.side}>
            {tip.text}
          </TooltipContent>
        )}
      </Tooltip>
    </div>
  );
}

type FileReference = Extract<MessageReference, { kind: "file" }>;

type Island =
  | {
      readonly kind: "code";
      readonly code: string;
      readonly language: string;
      readonly open: boolean;
    }
  | { readonly kind: "agent"; readonly session: string; readonly label: string }
  | { readonly kind: "image"; readonly src: string; readonly alt: string }
  | {
      readonly kind: "table";
      readonly head: MarkdownRow;
      readonly rows: readonly MarkdownRow[];
    }
  | { readonly kind: "citation"; readonly reference: FileReference };

interface MountedIsland {
  readonly key: string;
  readonly container: HTMLElement;
  readonly island: Island;
  readonly signature: string;
}

interface Tip {
  readonly anchor: HTMLElement;
  readonly text: string;
  readonly side: "top" | "bottom";
}

function IslandContent({ island }: { readonly island: Island }): ReactNode {
  switch (island.kind) {
    case "code":
      return !island.open && island.language === "mermaid" ? (
        <MermaidDiagram source={island.code} />
      ) : (
        <CodeBlock code={island.code} lang={island.language} streaming={island.open} />
      );
    case "agent":
      return <SubagentCitation session={asId<"session">(island.session)} label={island.label} />;
    case "image":
      return <MarkdownImage src={island.src} alt={island.alt} />;
    case "table":
      return <MarkdownTable head={island.head} rows={island.rows} />;
    case "citation":
      return island.reference.file.kind === "folder" ? (
        <Icon name="folder" size="xs" />
      ) : (
        <FileTypeIcon path={island.reference.file.path} />
      );
  }
}

function MarkdownImage({ src, alt }: { readonly src: string; readonly alt: string }): ReactNode {
  const folder = useChatFolder();
  const label = alt === "" ? "image" : alt;

  return (
    <span {...props(proseStyles.imageLabel)}>
      {folder === undefined || src === "" || URL_SCHEME.test(src) ? (
        label
      ) : (
        <FileImage workspace={folder.id} path={safeDecode(src)} label={label} />
      )}
    </span>
  );
}

function FileImage(input: {
  readonly workspace: WorkspaceId;
  readonly path: string;
  readonly label: string;
}): ReactNode {
  const url = useQuery({
    ...blobUrlQuery(["files", "bytes", input.workspace, input.path], () =>
      readImage(input.workspace, input.path),
    ),
    staleTime: 10_000,
    refetchOnMount: true,
  }).data;

  return url === undefined ? (
    input.label
  ) : (
    <span {...props(proseStyles.imageSpacing)}>
      <ImageViewer src={url} name={input.path.split("/").at(-1) ?? input.label}>
        <img src={url} alt={input.label} {...props(proseStyles.image)} />
      </ImageViewer>
    </span>
  );
}

async function readImage(workspace: WorkspaceId, path: string): Promise<ByteReader> {
  const reader = await (await filesFor(workspace)).bytes(path);

  if (reader.mime?.startsWith("image/") === true) return reader;
  await reader.close();

  throw new Error(`${path} is not an image.`);
}

function tipFor(target: EventTarget): Tip | undefined {
  if (!(target instanceof Element) || target.closest(OPAQUE_ISLAND) !== null) return undefined;
  const anchor = target.closest<HTMLElement>("[data-citation], a[href]");
  const cited = anchor?.dataset["tip"];

  if (anchor === null || anchor === undefined) return undefined;

  if (cited !== undefined) return { anchor, text: cited, side: "top" };
  const href = anchor.getAttribute("href") ?? "";

  return href === "" || href.startsWith("#") ? undefined : { anchor, text: href, side: "bottom" };
}

function watchIslands(
  publish: (update: (islands: readonly MountedIsland[]) => readonly MountedIsland[]) => void,
) {
  const owned = new WeakMap<HTMLElement, Pick<MountedIsland, "key" | "container">>();
  let created = 0;

  const adopt = (host: HTMLElement, island: Island): Pick<MountedIsland, "key" | "container"> => {
    const known = owned.get(host);

    if (known !== undefined) return known;
    created += 1;

    const container = document.createElement(
      island.kind === "code" || island.kind === "table" ? "div" : "span",
    );

    if (island.kind === "citation") container.className = iconClass;
    const fresh = { key: String(created), container };
    owned.set(host, fresh);

    return fresh;
  };

  const mount = (host: HTMLElement, island: Island, first: boolean): MountedIsland => {
    const slot = adopt(host, island);

    if (first ? host.firstChild !== slot.container : slot.container.parentNode !== host) {
      host.insertBefore(slot.container, first ? host.firstChild : null);
    }

    return { ...slot, island, signature: JSON.stringify(island) };
  };

  return {
    attach(element: HTMLDivElement, files: readonly MentionFile[]): () => void {
      const sync = (): void => {
        const placed = [...element.querySelectorAll<HTMLElement>(ISLAND)].flatMap((host) => {
          const island = readIsland(host);

          return island === undefined ? [] : [mount(host, island, false)];
        });

        const cited = citationHosts(element, files).map((citation) =>
          mount(citation.host, { kind: "citation", reference: citation.reference }, true),
        );

        const next = [...placed, ...cited];

        publish((current) =>
          next.length === current.length &&
          next.every(
            (island, index) =>
              island.key === current[index]?.key && island.signature === current[index]?.signature,
          )
            ? current
            : next,
        );
      };

      const observer = new MutationObserver(sync);

      observer.observe(element, {
        subtree: true,
        childList: true,
        attributeFilter: [
          "data-code",
          "data-language",
          "data-open",
          "data-src",
          "data-session",
          "data-table",
        ],
      });
      sync();

      return () => observer.disconnect();
    },
  };
}

function citationHosts(
  element: HTMLElement,
  files: readonly MentionFile[],
): readonly { readonly host: HTMLElement; readonly reference: FileReference }[] {
  return [...element.querySelectorAll<HTMLElement>("a[href], code")].flatMap((host) => {
    const code = host.localName === "code";

    if (host.closest(OPAQUE_ISLAND) !== null || (code && host.closest("a, pre") !== null)) {
      return [];
    }

    const reference = code
      ? inlineCodeReference(host.textContent ?? "", files)
      : linkReference(host.getAttribute("href") ?? "", files);

    if (reference?.kind !== "file") return [];

    if (host.dataset["citation"] !== reference.file.kind) {
      host.dataset["citation"] = reference.file.kind;
    }
    const title = referenceTitle(reference) ?? "";

    if (host.dataset["tip"] !== title) host.dataset["tip"] = title;

    if (code && !citedCodeClasses.every((name) => host.classList.contains(name))) {
      host.classList.add(...citedCodeClasses);
    }

    return [{ host, reference }];
  });
}

function readIsland(host: HTMLElement): Island | undefined {
  const data = host.dataset;

  switch (data["nyteIsland"]) {
    case "code": {
      const code = data["code"] ?? "";

      return {
        kind: "code",
        code: code.endsWith("\n") ? code.slice(0, -1) : code,
        language: data["language"] ?? "",
        open: data["open"] !== undefined,
      };
    }

    case "agent":
      return { kind: "agent", session: data["session"] ?? "", label: data["label"] ?? "" };
    case "image":
      return { kind: "image", src: data["src"] ?? "", alt: data["alt"] ?? "" };
    case "table":
      return readTable(data["table"] ?? "");
    default:
      return undefined;
  }
}

function readTable(html: string): Island {
  const template = document.createElement("template");
  template.innerHTML = html;

  const rows = (selector: string): readonly MarkdownRow[] =>
    [...template.content.querySelectorAll<HTMLTableRowElement>(selector)].map((row) =>
      [...row.cells].map((cell) => ({ html: cell.innerHTML, align: cellAlign(cell) })),
    );

  return { kind: "table", head: rows("thead > tr").at(-1) ?? [], rows: rows("tbody > tr") };
}

function cellAlign(cell: HTMLTableCellElement): MarkdownCell["align"] {
  const align = cell.style.textAlign;

  return align === "center" ? "center" : align === "right" ? "end" : "start";
}

function tableIsland(html: string): string {
  const escaped = html
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

  return `<div data-nyte-island="table" data-prose-table class="${tableHostClass}" data-table="${escaped}"></div>`;
}

function attribute(tag: string, name: string): string {
  return new RegExp(`\\s${name}="([^"]*)"`, "u").exec(tag)?.[1] ?? "";
}

function codeBlockIsland(html: string): string {
  if (!html.startsWith(CODE_BLOCK)) return html;
  const tag = html.slice(0, html.indexOf(">"));

  const code = html.slice(
    html.indexOf(">", html.indexOf("<code")) + 1,
    html.lastIndexOf("</code>"),
  );

  return `<figure data-nyte-island="code" role="none" class="${slotClass}" data-language="${attribute(tag, "data-language")}"${tag.includes(" data-incomplete=") ? " data-open" : ""} data-code="${code.replaceAll(/<[^>]*>/gu, "")}"></figure>`;
}

function agentIsland(html: string): string {
  const tag = html.slice(0, html.indexOf(">"));
  const href = attribute(tag, "href");

  if (!href.startsWith(`#${AGENT_LINK}`)) return webLink(html);
  const inner = html.slice(tag.length + 1, html.lastIndexOf("</a>"));
  const session = href.slice(AGENT_LINK.length + 1);

  if (session === "") return inner;

  return `<span data-nyte-island="agent" data-session="${session}" data-label="${inner.replaceAll(/<[^>]*>/gu, "").replaceAll('"', "&quot;")}"></span>`;
}

function imageIsland(html: string): string {
  return `<span data-nyte-island="image" data-src="${attribute(html, "src")}" data-alt="${attribute(html, "alt")}"></span>`;
}

function clickAction(
  target: EventTarget,
  opener: ReferenceOpener | undefined,
  files: readonly MentionFile[],
): (() => void) | undefined {
  if (!(target instanceof Element) || target.closest(OPAQUE_ISLAND) !== null) return undefined;
  const href = target.closest("a[href]")?.getAttribute("href");

  if (href === undefined || href === null) {
    const code = target.closest("code");

    if (code === null || code.closest("pre") !== null || opener === undefined) return undefined;
    const reference = inlineCodeReference(code.textContent ?? "", files);

    return reference === undefined ? undefined : opener(reference);
  }

  if (href.startsWith("#")) {
    return () =>
      target.ownerDocument.getElementById(href.slice(1))?.scrollIntoView({ block: "center" });
  }

  const reference = opener === undefined ? undefined : linkReference(href, files);

  return (
    (reference === undefined ? undefined : opener?.(reference)) ??
    (() => openConversationLink(href, opener))
  );
}
