import type { Fragment, Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { MarkdownLayout } from "./markdown-parse.ts";

/** The parsed document's nodes beside their source, so unchanged parts serialize as written. */
export interface MarkdownOrigin {
  readonly layout: MarkdownLayout;
  readonly blocks: ReadonlyMap<number, ProseMirrorNode>;
  readonly inlines: ReadonlyMap<number, Fragment>;
}

interface InlineContext {
  readonly origin: MarkdownOrigin;
  /** Emphasis characters that appear more than once in the textblock, so could pair up. */
  readonly paired?: string;
  /** Soft breaks read as spaces where a line can't break: ATX headings and table cells. */
  readonly singleLine: boolean;
  readonly table: boolean;
}

export function markdownOrigin(doc: ProseMirrorNode, layout: MarkdownLayout): MarkdownOrigin {
  const blocks = new Map<number, ProseMirrorNode>();
  const inlines = new Map<number, Fragment>();

  doc.forEach((node) => {
    const origin = index(node.attrs["origin"]);

    if (origin !== undefined) blocks.set(origin, node);
  });
  doc.descendants((node) => {
    const inline = index(node.attrs["inlineOrigin"]);

    if (inline !== undefined) inlines.set(inline, node.content);
  });

  return { layout, blocks, inlines };
}

function index(value: unknown): number | undefined {
  return Number.isInteger(value) ? Number(value) : undefined;
}

/** Writes the document as markdown; a block or paragraph left as parsed comes back byte for byte. */
export function serializeMarkdown(doc: ProseMirrorNode, origin: MarkdownOrigin): string {
  const layout = origin.layout;
  const empty = doc.childCount === 1 && doc.firstChild?.type.name === "paragraph";

  if (empty && doc.firstChild?.content.size === 0) return withEol(layout.prefix, layout.eol);
  const nodes: ProseMirrorNode[] = [];
  doc.forEach((node) => nodes.push(node));

  const written = nodes.map((node) => {
    const source = index(node.attrs["origin"]);
    const original = source === undefined ? undefined : origin.blocks.get(source);
    const unchanged = original !== undefined && (original === node || original.eq(node));

    return {
      node,
      source,
      unchanged,
      sameType: original?.type === node.type,
      text: unchanged && source !== undefined ? (layout.blocks[source]?.source ?? "") : undefined,
    };
  });

  const body = written.map((block, position) => {
    const previous = written[position - 1];
    const text = block.text ?? serializeBlock(block.node, origin);

    const before =
      previous === undefined
        ? layout.prefix
        : previous.source !== undefined && block.source === previous.source + 1
          ? (layout.blocks[previous.source]?.gap ?? "\n\n")
          : "\n\n";

    const kept =
      previous === undefined ||
      /\n[ \t]*\n/u.test(before) ||
      (previous.unchanged && block.unchanged) ||
      (previous.sameType && block.sameType);

    const separator = kept ? before : "\n\n";

    return (block.text === undefined ? separator.replace(/[ \t]+$/u, "") : separator) + text;
  });

  return withEol(body.join("") + layout.trailing, layout.eol);
}

function withEol(text: string, eol: "\n" | "\r\n"): string {
  return eol === "\n" ? text : text.replaceAll("\n", eol);
}

function children(node: ProseMirrorNode): ProseMirrorNode[] {
  const nodes: ProseMirrorNode[] = [];
  node.forEach((child) => nodes.push(child));

  return nodes;
}

function attribute(node: ProseMirrorNode | Mark, name: string, fallback: string): string {
  const value: unknown = node.attrs[name];

  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}

function serializeBlock(node: ProseMirrorNode, origin: MarkdownOrigin): string {
  switch (node.type.name) {
    case "paragraph":
      return serializeInline(node, { origin, singleLine: false, table: false });
    case "heading": {
      const level = Number(node.attrs["level"]);
      const underline = attribute(node, "underline", "");

      if (underline !== "" && level <= 2)
        return `${serializeInline(node, { origin, singleLine: false, table: false })}\n${
          underline.startsWith(level === 1 ? "=" : "-")
            ? underline
            : (level === 1 ? "=" : "-").repeat(3)
        }`;
      const content = serializeInline(node, { origin, singleLine: true, table: false });

      return `${"#".repeat(level)}${content === "" ? "" : ` ${content}`}${attribute(node, "close", "")}`;
    }

    case "blockquote":
      return children(node)
        .map((child) => serializeBlock(child, origin))
        .join("\n\n")
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    case "bulletList":
    case "orderedList":
      return serializeList(node, origin);
    case "codeBlock":
      return serializeCode(node);
    case "horizontalRule":
      return attribute(node, "marker", "---");
    case "table":
      return serializeTable(node, origin);
    case "rawBlock":
      return attribute(node, "source", "");
    default:
      return node.textContent;
  }
}

function serializeList(list: ProseMirrorNode, origin: MarkdownOrigin): string {
  const ordered = list.type.name === "orderedList";
  const start = Number(list.attrs["start"] ?? 1);
  const indent = " ".repeat(Number(list.attrs["indent"] ?? 0));

  const items = children(list).map((item, position) => {
    const marker = ordered
      ? `${String(list.attrs["increment"] === false ? start : start + position)}${attribute(list, "delimiter", ".")}`
      : attribute(list, "marker", "-");

    const padding = " ".repeat(Number(item.attrs["padding"] ?? 1));
    const checked: unknown = item.attrs["checked"];
    const task = checked === null ? "" : checked === true ? "[x] " : "[ ] ";
    const continuation = " ".repeat(indent.length + marker.length + padding.length);

    const lines = joinBlocks(
      item,
      children(item).map((child) => serializeBlock(child, origin)),
    ).split("\n");

    return lines
      .map((line, number) =>
        number === 0
          ? `${indent}${marker}${line === "" && task === "" ? "" : `${padding}${task}${line}`}`.trimEnd()
          : line === ""
            ? ""
            : `${continuation}${line}`,
      )
      .join("\n");
  });

  return joinBlocks(list, items);
}

/** Joins a container's children with the blank lines the source had between them. */
function joinBlocks(container: ProseMirrorNode, blocks: readonly string[]): string {
  const gaps: unknown = container.attrs["gaps"];
  const spread = container.attrs["spread"] === true;

  return blocks
    .map((block, position) => {
      if (position === 0) return block;
      const blank: unknown = Array.isArray(gaps) ? gaps[position - 1] : undefined;

      return `${blank === true || (blank === undefined && spread) ? "\n\n" : "\n"}${block}`;
    })
    .join("");
}

function serializeCode(node: ProseMirrorNode): string {
  const code = node.textContent;

  if (node.attrs["indented"] === true && code !== "")
    return code
      .split("\n")
      .map((line) => (line === "" ? "" : `    ${line}`))
      .join("\n");
  const fence = attribute(node, "fence", "```");
  const character = fence.charAt(0);

  const longest = Math.max(
    0,
    ...[...code.matchAll(new RegExp(`^ {0,3}(${character}+)`, "gmu"))].map(
      (match) => match[1]?.length ?? 0,
    ),
  );

  const closing = longest >= fence.length ? character.repeat(longest + 1) : fence;

  return `${closing}${attribute(node, "info", "")}\n${code === "" ? "" : `${code}\n`}${closing}`;
}

function serializeTable(table: ProseMirrorNode, origin: MarkdownOrigin): string {
  const delimiter = attribute(table, "delimiter", "");
  const widths = tableCells(delimiter).map((cell) => cell.trim().length);
  const align: unknown = table.attrs["align"];
  const alignment = Array.isArray(align) ? align.map((value) => String(value)) : [];
  const aligned = table.attrs["aligned"] === true;
  const rows = children(table);
  const columns = Math.max(0, ...rows.map((row) => row.childCount));

  const lines = rows.map((row) => {
    const source = index(row.attrs["inlineOrigin"]);

    if (source !== undefined && origin.inlines.get(source)?.eq(row.content) === true)
      return origin.layout.inlines[source] ?? "";

    const cells = children(row).map((cell, column) => {
      const content = serializeInline(cell, { origin, singleLine: true, table: true });

      return aligned ? pad(content, widths[column] ?? 0, alignment[column]) : content;
    });

    return `|${cells.map((cell) => (cell === "" ? " " : ` ${cell} `)).join("|")}|`;
  });

  const rule =
    widths.length === columns
      ? delimiter
      : `| ${Array.from({ length: columns }, (_, column) => delimiterCell(alignment[column], 3)).join(" | ")} |`;

  return [lines[0] ?? "", rule, ...lines.slice(1)].join("\n");
}

/** The cells of a table line, outer pipes removed. */
function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/u, "")
    .replace(/(?<!\\)\|$/u, "")
    .split(/(?<!\\)\|/u);
}

function delimiterCell(align: string | undefined, width: number): string {
  if (align === "center") return `:${"-".repeat(width - 2)}:`;

  if (align === "left") return `:${"-".repeat(width - 1)}`;

  if (align === "right") return `${"-".repeat(width - 1)}:`;

  return "-".repeat(width);
}

/** Pads a cell to its column's source width; a cell edited past that width goes unpadded. */
function pad(text: string, width: number, align: string | undefined): string {
  const space = Math.max(0, width - text.length);

  if (align === "right") return " ".repeat(space) + text;

  if (align === "center")
    return " ".repeat(Math.floor(space / 2)) + text + " ".repeat(Math.ceil(space / 2));

  return text + " ".repeat(space);
}

function serializeInline(node: ProseMirrorNode, context: InlineContext): string {
  const source = index(node.attrs["inlineOrigin"]);
  const original = source === undefined ? undefined : context.origin.inlines.get(source);

  if (source !== undefined && original?.eq(node.content) === true)
    return context.origin.layout.inlines[source] ?? "";
  const nodes = children(node);
  const plain = node.textContent;

  const paired = ["*", "_", "~"]
    .filter((character) => plain.indexOf(character) !== plain.lastIndexOf(character))
    .join("");

  const local = { ...context, paired };
  let open: readonly Mark[] = [];
  let code = "";
  let lineStart = !context.singleLine;
  const parts: string[] = [];

  const close = (mark: Mark): string => {
    if (mark.type.name !== "code") return closeMark(mark);
    const fence = code;
    code = "";

    return fence.split("").toReversed().join("");
  };

  nodes.forEach((child, position) => {
    const marks = child.marks;
    const shared = marks.findIndex((mark, at) => open[at]?.eq(mark) !== true);
    const keep = shared === -1 ? Math.min(marks.length, open.length) : shared;
    parts.push(...open.slice(keep).toReversed().map(close));

    for (const mark of marks.slice(keep)) {
      if (mark.type.name === "code") {
        const run = nodes.slice(position);
        const end = run.findIndex((next) => !mark.isInSet(next.marks));

        const text = (end === -1 ? run : run.slice(0, end))
          .map((next) => next.textContent)
          .join("");

        code = codeFence(mark, text);
      }

      parts.push(mark.type.name === "code" ? code : openMark(mark));
    }

    open = marks;
    const written = serializeLeaf(child, local, lineStart);
    parts.push(written);
    lineStart = written.endsWith("\n") || (lineStart && written === "");
  });
  parts.push(...open.toReversed().map(close));

  return parts.join("");
}

/** The opening backticks and padding of a code span; the closing is its mirror. */
function codeFence(mark: Mark, text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((match) => match[0].length));
  const ticks = Number(mark.attrs["ticks"] ?? 1);

  const padding =
    mark.attrs["padded"] === true ||
    text.startsWith("`") ||
    text.endsWith("`") ||
    (/^ [\s\S]* $/u.test(text) && text.trim() !== "")
      ? " "
      : "";

  return "`".repeat(longest >= ticks ? longest + 1 : ticks) + padding;
}

function openMark(mark: Mark): string {
  return mark.type.name === "link" ? attribute(mark, "open", "[") : attribute(mark, "marker", "");
}

function closeMark(mark: Mark): string {
  if (mark.type.name !== "link") return attribute(mark, "marker", "");
  const open = attribute(mark, "open", "[");

  if (open === "<") return ">";

  return open === "" ? "" : attribute(mark, "close", `](${attribute(mark, "href", "")})`);
}

function serializeLeaf(node: ProseMirrorNode, context: InlineContext, lineStart: boolean): string {
  switch (node.type.name) {
    case "text": {
      const text = node.text ?? "";

      if (node.marks.some((mark) => mark.type.name === "code"))
        return context.table ? text.replaceAll("|", "\\|") : text;

      return escapeText(text, lineStart, context);
    }

    case "softBreak":
      return context.singleLine ? "&#xA;" : "\n";
    case "hardBreak":
      return context.singleLine ? " " : `${attribute(node, "marker", "\\")}\n`;
    case "image":
      return attribute(
        node,
        "raw",
        `![${escapeText(attribute(node, "alt", ""), false, context)}](${attribute(node, "src", "")})`,
      );
    case "rawInline":
      return attribute(node, "source", "");
    default:
      return node.textContent;
  }
}

/** Escapes what would otherwise read as markdown syntax in text the user typed. */
function escapeText(text: string, lineStart: boolean, context: InlineContext): string {
  const paired = context.paired ?? "";

  const escaped = text
    .replaceAll(/\\(?=[!-/:-@[-`{-~]|$)/gu, "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll(/\*(?!\s)|(?<!\s)\*/gu, (match) => (paired.includes("*") ? `\\${match}` : match))
    .replaceAll(/~(?!\s)|(?<!\s)~/gu, (match) => (paired.includes("~") ? `\\${match}` : match))
    .replaceAll(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, (match) =>
      paired.includes("_") ? `\\${match}` : match,
    )
    .replaceAll(/\[(?=[^\]]*\][([])/gu, "\\[")
    .replaceAll(/<(?=[A-Za-z/!?])/gu, "\\<")
    .replaceAll(/&(?=#?\w+;)/gu, "\\&")
    .replaceAll("|", context.table ? "\\|" : "|");

  if (!lineStart) return escaped;

  return escaped
    .replace(/^\[(?=[^\]]*\]:)/u, "\\[")
    .replace(/^(#{1,6})(?=\s|$)/u, "\\$1")
    .replace(/^([>+-])(?=\s|$)/u, "\\$1")
    .replace(/^(\d+)([.)])(?=\s|$)/u, "$1\\$2")
    .replace(/^(=+|-+)(?=\s*$)/u, "\\$1");
}
