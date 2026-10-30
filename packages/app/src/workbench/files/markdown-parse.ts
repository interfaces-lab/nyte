import type { JSONContent } from "@tiptap/core";
import type {
  BlockContent,
  DefinitionContent,
  ListItem,
  Nodes,
  PhrasingContent,
  RootContent,
  Table,
} from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

/** The source a document was parsed from, so unchanged parts serialize back byte for byte. */
export interface MarkdownLayout {
  /** Frontmatter and blank lines before the first block. */
  readonly prefix: string;
  /** Each top-level block's source and the text up to the next block. */
  readonly blocks: readonly { readonly source: string; readonly gap: string }[];
  /** The text after the last block. */
  readonly trailing: string;
  /** The source of each textblock's inline content, container prefixes removed. */
  readonly inlines: readonly string[];
  readonly eol: "\n" | "\r\n";
}

export interface ParsedMarkdown {
  readonly content: JSONContent;
  readonly layout: MarkdownLayout;
}

interface Context {
  readonly source: string;
  /** Removes the enclosing containers' prefixes from a continuation line. */
  readonly strip: (line: string) => string;
  /** The column where the enclosing container's content starts. */
  readonly column: number;
  readonly inlines: string[];
  readonly definitions: ReadonlyMap<string, string>;
}

type Mark = NonNullable<JSONContent["marks"]>[number];

const FRONTMATTER = /^---[ \t]*\n(?:[\s\S]*?\n)?(?:---|\.\.\.)[ \t]*(?:\n|$)/u;

const MARKDOWN_PATH = /\.(?:md|markdown)$/iu;

export function opensAsMarkdown(path: string): boolean {
  return MARKDOWN_PATH.test(path);
}

export function parseMarkdown(text: string): ParsedMarkdown {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const normalized = eol === "\r\n" ? text.replaceAll("\r\n", "\n") : text;
  const frontmatter = FRONTMATTER.exec(normalized)?.[0] ?? "";
  const source = normalized.slice(frontmatter.length);
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });

  const context: Context = {
    source,
    strip: (line) => line,
    column: 0,
    inlines: [],
    definitions: new Map(collectDefinitions(tree.children)),
  };

  const children = tree.children;
  const first = children[0];
  const last = children.at(-1);

  return {
    content: {
      type: "doc",
      content:
        children.length === 0
          ? [{ type: "paragraph" }]
          : children.map((child, index) => {
              const block = convertBlock(child, context);

              return { ...block, attrs: { ...block.attrs, origin: index } };
            }),
    },
    layout: {
      prefix: frontmatter + (first === undefined ? source : source.slice(0, start(first))),
      blocks: children.map((child, index) => ({
        source: slice(child, context),
        gap: source.slice(end(child), start(children[index + 1] ?? child, source.length)),
      })),
      trailing: last === undefined ? eol : source.slice(end(last)),
      inlines: context.inlines,
      eol,
    },
  };
}

/** The frontmatter's top-level properties, or undefined when the file has none. */
export function readFrontmatter(text: string): [key: string, value: string][] | undefined {
  const frontmatter = FRONTMATTER.exec(text.replaceAll("\r\n", "\n"))?.[0];

  return frontmatter === undefined ? undefined : frontmatterEntries(frontmatter);
}

function collectDefinitions(nodes: readonly RootContent[]): [string, string][] {
  return nodes.flatMap((node) => [
    ...(node.type === "definition" ? [[node.identifier, node.url] satisfies [string, string]] : []),
    ...("children" in node ? collectDefinitions(node.children) : []),
  ]);
}

function start(node: Nodes, fallback = 0): number {
  return node.position?.start.offset ?? fallback;
}

function end(node: Nodes): number {
  return node.position?.end.offset ?? start(node);
}

function slice(node: Nodes, context: Context): string {
  return context.source.slice(start(node), end(node));
}

/** The node's source with the containers' prefixes removed from every line after the first. */
function rawLines(text: string, context: Context): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : context.strip(line)))
    .join("\n");
}

function stripSpaces(line: string, count: number): string {
  const indent = /^ */u.exec(line)?.[0].length ?? 0;

  return line.slice(Math.min(indent, count));
}

function convertBlock(
  node: RootContent | BlockContent | DefinitionContent,
  context: Context,
): JSONContent {
  switch (node.type) {
    case "paragraph":
      return {
        type: "paragraph",
        attrs: { inlineOrigin: inlineSource(node.children, context) },
        content: convertInline(node.children, context, []),
      };
    case "heading": {
      const raw = slice(node, context);
      const lines = raw.split("\n");
      const setext = !raw.startsWith("#");

      return {
        type: "heading",
        attrs: {
          level: node.depth,
          underline: setext ? context.strip(lines.at(-1) ?? "") : "",
          close: setext ? "" : (/[ \t]+#+[ \t]*$/u.exec(raw)?.[0] ?? ""),
          inlineOrigin: inlineSource(node.children, context),
        },
        content: convertInline(node.children, context, []),
      };
    }

    case "blockquote": {
      const quoted: Context = {
        ...context,
        strip: (line) => context.strip(line).replace(/^ {0,3}> ?/u, ""),
        column: (node.children[0]?.position?.start.column ?? 1) - 1,
      };

      return {
        type: "blockquote",
        content: nonEmpty(node.children.map((child) => convertBlock(child, quoted))),
      };
    }

    case "list": {
      const first = node.children[0];
      const firstRaw = first === undefined ? "" : slice(first, context);
      const ordered = node.ordered === true;
      const indent = Math.max(0, (first?.position?.start.column ?? 1) - 1 - context.column);
      const second = node.children[1];

      return {
        type: ordered ? "orderedList" : "bulletList",
        attrs: {
          spread: node.spread === true,
          gaps: gaps(node.children, context),
          indent,
          ...(ordered
            ? {
                start: node.start ?? 1,
                delimiter: /^\d+([.)])/u.exec(firstRaw)?.[1] ?? ".",
                increment:
                  second === undefined ||
                  Number(/^\d+/u.exec(slice(second, context))?.[0]) !== node.start,
              }
            : { marker: firstRaw.charAt(0) || "-" }),
        },
        content: node.children.map((item) => convertItem(item, indent, context)),
      };
    }

    case "listItem":
      return convertItem(node, 0, context);
    case "code": {
      const raw = slice(node, context);
      const fence = /^(`{3,}|~{3,})(.*)/u.exec(raw);

      return {
        type: "codeBlock",
        attrs: {
          fence: fence?.[1] ?? "```",
          info: fence?.[2] ?? "",
          indented: fence === null,
        },
        content: node.value === "" ? [] : [{ type: "text", text: node.value }],
      };
    }

    case "thematicBreak":
      return { type: "horizontalRule", attrs: { marker: slice(node, context) } };
    case "table":
      return convertTable(node, context);
    case "html":
      return rawBlock("html", node, context);
    case "definition":
      return rawBlock("definition", node, context);
    case "footnoteDefinition":
      return rawBlock("footnote", node, context);
    default:
      return rawBlock(node.type, node, context);
  }
}

function nonEmpty(content: JSONContent[]): JSONContent[] {
  return content.length === 0 ? [{ type: "paragraph" }] : content;
}

/** Whether a blank line separates each pair of siblings. */
function gaps(nodes: readonly Nodes[], context: Context): boolean[] {
  return nodes
    .slice(1)
    .map((node, position) =>
      /\n[ \t>]*\n/u.test(context.source.slice(end(nodes[position] ?? node), start(node))),
    );
}

function rawBlock(kind: string, node: Nodes, context: Context): JSONContent {
  return { type: "rawBlock", attrs: { kind, source: rawLines(slice(node, context), context) } };
}

function convertItem(item: ListItem, listIndent: number, context: Context): JSONContent {
  const raw = slice(item, context);
  const marker = /^(?:[-+*]|\d+[.)])/u.exec(raw)?.[0] ?? "-";
  const rest = raw.slice(marker.length).split("\n")[0] ?? "";
  const spaces = /^ */u.exec(rest)?.[0].length ?? 0;
  const padding = rest.trim() === "" || spaces > 4 || spaces === 0 ? 1 : spaces;
  const width = listIndent + marker.length + padding;

  const nested: Context = {
    ...context,
    strip: (line) => stripSpaces(context.strip(line), width),
    column: context.column + width,
  };

  return {
    type: "listItem",
    attrs: {
      checked: item.checked ?? null,
      spread: item.spread === true,
      gaps: gaps(item.children, context),
      padding,
    },
    content: nonEmpty(item.children.map((child) => convertBlock(child, nested))),
  };
}

function convertTable(table: Table, context: Context): JSONContent {
  const lines = rawLines(slice(table, context), context).split("\n");

  return {
    type: "table",
    attrs: {
      align: table.align ?? [],
      aligned: /-{4}/u.test(lines[1] ?? ""),
      delimiter: lines[1] ?? "",
    },
    content: table.children.map((row, index) => ({
      type: "tableRow",
      attrs: { inlineOrigin: context.inlines.push(rawLines(slice(row, context), context)) - 1 },
      content: row.children.map((cell, column) => ({
        type: index === 0 ? "tableHeader" : "tableCell",
        attrs: {
          align: table.align?.[column] ?? null,
          inlineOrigin: inlineSource(cell.children, context),
        },
        content: convertInline(cell.children, context, []),
      })),
    })),
  };
}

/** Registers the source of a textblock's inline content and returns its index. */
function inlineSource(children: readonly PhrasingContent[], context: Context): number {
  const first = children[0];
  const last = children.at(-1);

  const raw =
    first === undefined || last === undefined
      ? ""
      : rawLines(context.source.slice(start(first), end(last)), context);

  return context.inlines.push(raw) - 1;
}

function convertInline(
  nodes: readonly PhrasingContent[],
  context: Context,
  marks: readonly Mark[],
): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    switch (node.type) {
      case "text":
        return node.value
          .split("\n")
          .flatMap((line, index): JSONContent[] => [
            ...(index === 0 ? [] : [{ type: "softBreak", marks: [...marks] }]),
            ...(line === "" ? [] : [{ type: "text", text: line, marks: [...marks] }]),
          ]);
      case "emphasis":
        return convertInline(node.children, context, [
          ...marks,
          { type: "italic", attrs: { marker: context.source.charAt(start(node)) } },
        ]);
      case "strong":
        return convertInline(node.children, context, [
          ...marks,
          { type: "bold", attrs: { marker: context.source.slice(start(node), start(node) + 2) } },
        ]);
      case "delete":
        return convertInline(node.children, context, [
          ...marks,
          {
            type: "strike",
            attrs: { marker: context.source.startsWith("~~", start(node)) ? "~~" : "~" },
          },
        ]);
      case "inlineCode": {
        const raw = slice(node, context);
        const ticks = /^`+/u.exec(raw)?.[0].length ?? 1;

        return [
          {
            type: "text",
            text: node.value,
            marks: [
              ...marks,
              {
                type: "code",
                attrs: {
                  ticks,
                  padded:
                    raw.charAt(ticks) === " " &&
                    raw.charAt(raw.length - ticks - 1) === " " &&
                    node.value.trim() !== "",
                },
              },
            ],
          },
        ];
      }

      case "link":
      case "linkReference": {
        const last = node.children.at(-1);

        if (last === undefined) return [rawInline(node, context, marks)];
        const open = context.source.charAt(start(node));

        const href =
          node.type === "link" ? node.url : (context.definitions.get(node.identifier) ?? "");

        const close =
          open === "[" ? context.source.slice(end(last), end(node)) : open === "<" ? ">" : "";

        return convertInline(node.children, context, [
          {
            type: "link",
            attrs: {
              href,
              title: node.type === "link" ? (node.title ?? null) : null,
              open: open === "[" || open === "<" ? open : "",
              close: rawLines(close, context),
            },
          },
          ...marks,
        ]);
      }

      case "image":
      case "imageReference":
        return [
          {
            type: "image",
            attrs: {
              src:
                node.type === "image" ? node.url : (context.definitions.get(node.identifier) ?? ""),
              alt: node.alt ?? "",
              title: node.type === "image" ? (node.title ?? null) : null,
              raw: rawLines(slice(node, context), context),
            },
            marks: [...marks],
          },
        ];
      case "break":
        return [
          {
            type: "hardBreak",
            attrs: { marker: slice(node, context).replace(/\n[\s\S]*$/u, "") },
            marks: [...marks],
          },
        ];
      case "html":
      case "footnoteReference":
        return [rawInline(node, context, marks)];
      default: {
        const exhaustive: never = node;

        return exhaustive;
      }
    }
  });
}

function rawInline(node: Nodes, context: Context, marks: readonly Mark[]): JSONContent {
  return {
    type: "rawInline",
    attrs: { source: rawLines(slice(node, context), context) },
    marks: [...marks],
  };
}

/** Top-level `key: value` pairs; a nested value reads as one line. */
function frontmatterEntries(frontmatter: string): [string, string][] {
  const lines = frontmatter.split("\n");

  const body = lines.slice(
    1,
    lines.findLastIndex((line) => /^(?:---|\.\.\.)/u.test(line)),
  );

  return body
    .join("\n")
    .split(/\n(?=[^\s#][^:\n]*:(?:[ \t]|\n|$))/u)
    .flatMap((chunk): [string, string][] => {
      const entry = /^([^\s#][^:\n]*):[ \t]*(.*)$/mu.exec(chunk);

      if (entry === null) return [];

      const rest = chunk
        .split("\n")
        .slice(1)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));

      const head = entry[2]?.trim() ?? "";
      const items = rest.length > 0 && rest.every((line) => line.startsWith("- "));

      const value = [
        /^[>|][-+]?$/u.test(head) ? "" : unquote(head),
        ...rest.map((line) => (items ? unquote(line.slice(2).trim()) : line)),
      ]
        .filter((part) => part !== "")
        .join(items ? ", " : " ");

      return [[entry[1]?.trim() ?? "", value]];
    });
}

function unquote(value: string): string {
  return /^(["']).*\1$/u.test(value) ? value.slice(1, -1) : value;
}
