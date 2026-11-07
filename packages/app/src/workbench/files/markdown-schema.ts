import {
  Extension,
  Mark,
  markInputRule,
  Node,
  nodeInputRule,
  textblockTypeInputRule,
  wrappingInputRule,
} from "@tiptap/core";
import type { Attribute, Extensions } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { goToNextCell, tableEditing } from "@tiptap/pm/tables";
import { props } from "@stylexjs/stylex";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { codeBlockStyles, proseStyles } from "../../chat/markdown/prose.stylex.ts";
import { markdownStyles } from "./markdown.stylex.ts";

/** An attribute that only the markdown source sets; pasted HTML leaves it at its default. */
function kept(value: unknown): Attribute {
  return { default: value, rendered: false, parseHTML: () => null };
}

function css(styles: { readonly className?: string }): string {
  return styles.className ?? "";
}

/** An index into the parsed source; a split or pasted node starts without one. */
const sourceIndex: Attribute = { ...kept(null), keepOnSplit: false };

const HEADINGS = [1, 2, 3, 4, 5, 6] as const;

const headingStyles = {
  1: proseStyles.h1,
  2: proseStyles.h2,
  3: proseStyles.h3,
  4: proseStyles.h4,
  5: proseStyles.h5,
  6: proseStyles.h6,
};

const Doc = Node.create({ name: "doc", topNode: true, content: "block+" });

const Text = Node.create({ name: "text", group: "inline" });

const Paragraph = Node.create({
  name: "paragraph",
  priority: 1000,
  group: "block",
  content: "inline*",
  addAttributes: () => ({ inlineOrigin: sourceIndex }),
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", { class: css(props(proseStyles.paragraph)) }, 0],
});

const Heading = Node.create({
  name: "heading",
  group: "block",
  content: "inline*",
  defining: true,
  addAttributes: () => ({
    level: { default: 1, rendered: false },
    underline: kept(""),
    close: kept(""),
    inlineOrigin: sourceIndex,
  }),
  parseHTML: () => HEADINGS.map((level) => ({ tag: `h${level}`, attrs: { level } })),
  renderHTML: ({ node }) => {
    const level = HEADINGS.find((candidate) => candidate === node.attrs["level"]) ?? 1;

    return [
      `h${level}`,
      { class: css(props(proseStyles.heading, headingStyles[level], markdownStyles.heading)) },
      0,
    ];
  },
  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^(#{1,6})\s$/u,
        type: this.type,
        getAttributes: (match) => ({ level: match[1]?.length ?? 1 }),
      }),
    ];
  },
});

const Blockquote = Node.create({
  name: "blockquote",
  group: "block",
  content: "block+",
  defining: true,
  parseHTML: () => [{ tag: "blockquote" }],
  renderHTML: () => ["blockquote", { class: css(props(proseStyles.blockquote)) }, 0],
  addInputRules() {
    return [wrappingInputRule({ find: /^\s*>\s$/u, type: this.type })];
  },
});

const BulletList = Node.create({
  name: "bulletList",
  group: "block",
  content: "listItem+",
  addAttributes: () => ({
    marker: kept("-"),
    spread: kept(false),
    gaps: kept([]),
    indent: kept(0),
  }),
  parseHTML: () => [{ tag: "ul" }],
  renderHTML: () => ["ul", { class: css(props(proseStyles.list)) }, 0],
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^\s*([-+*])\s$/u,
        type: this.type,
        getAttributes: (match) => ({ marker: match[1] ?? "-" }),
      }),
    ];
  },
});

const OrderedList = Node.create({
  name: "orderedList",
  group: "block",
  content: "listItem+",
  addAttributes: () => ({
    start: {
      default: 1,
      rendered: false,
      parseHTML: (element) => Number(element.getAttribute("start") ?? 1),
    },
    delimiter: kept("."),
    increment: kept(true),
    spread: kept(false),
    gaps: kept([]),
    indent: kept(0),
  }),
  parseHTML: () => [{ tag: "ol" }],
  renderHTML: ({ node }) => [
    "ol",
    { start: String(node.attrs["start"]), class: css(props(proseStyles.list)) },
    0,
  ],
  addInputRules() {
    return [
      wrappingInputRule({
        find: /^(\d+)([.)])\s$/u,
        type: this.type,
        getAttributes: (match) => ({ start: Number(match[1]), delimiter: match[2] ?? "." }),
        joinPredicate: (match, node) =>
          node.childCount + Number(node.attrs["start"]) === Number(match[1]),
      }),
    ];
  },
});

const ListItem = Node.create({
  name: "listItem",
  content: "block+",
  defining: true,
  addAttributes: () => ({
    checked: {
      default: null,
      parseHTML: (element) => {
        const checked = element.getAttribute("data-checked");

        return checked === null ? null : checked === "true";
      },
      renderHTML: (attributes) =>
        attributes["checked"] === null ? null : { "data-checked": String(attributes["checked"]) },
    },
    spread: kept(false),
    gaps: kept([]),
    padding: kept(1),
  }),
  parseHTML: () => [{ tag: "li" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "li",
    {
      ...HTMLAttributes,
      class: css(
        props(proseStyles.listItem, node.attrs["checked"] !== null && markdownStyles.taskItem),
      ),
    },
    0,
  ],
  addNodeView: () => (view) => {
    const item = document.createElement("li");
    const content = document.createElement("div");
    const checkbox = document.createElement("input");
    let node = view.node;

    const render = (): void => {
      const checked: unknown = node.attrs["checked"];
      item.className = css(
        props(proseStyles.listItem, checked !== null && markdownStyles.taskItem),
      );
      checkbox.hidden = checked === null;
      checkbox.checked = checked === true;
      checkbox.disabled = !view.editor.isEditable;
    };

    checkbox.type = "checkbox";
    checkbox.contentEditable = "false";
    checkbox.className = css(props(markdownStyles.checkbox));
    checkbox.addEventListener("change", () => {
      const position = view.getPos();

      if (position === undefined) return;
      view.editor.view.dispatch(
        view.editor.state.tr.setNodeMarkup(position, undefined, {
          ...node.attrs,
          checked: checkbox.checked,
        }),
      );
    });
    item.append(checkbox, content);
    render();

    return {
      dom: item,
      contentDOM: content,
      ignoreMutation: (mutation) => mutation.target === checkbox,
      update: (next) => {
        if (next.type !== node.type) return false;
        node = next;
        render();

        return true;
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const $from = this.editor.state.selection.$from;

        if ($from.depth === 0) return false;
        const item = $from.node(-1);
        const checked = item.type.name === this.name && item.attrs["checked"] !== null;

        return this.editor.commands.splitListItem(this.name, checked ? { checked: false } : {});
      },
      Tab: () => this.editor.commands.sinkListItem(this.name),
      "Shift-Tab": () => this.editor.commands.liftListItem(this.name),
    };
  },
});

export const MarkdownCodeBlock = Node.create({
  name: "codeBlock",
  group: "block",
  content: "text*",
  marks: "",
  code: true,
  defining: true,
  whitespace: "pre",
  addAttributes: () => ({
    info: {
      default: "",
      rendered: false,
      parseHTML: (element) =>
        /language-(\S+)/u.exec(element.querySelector("code")?.className ?? "")?.[1] ?? "",
    },
    fence: kept("```"),
    indented: kept(false),
  }),
  parseHTML: () => [{ tag: "pre", preserveWhitespace: "full" }],
  renderHTML: () => [
    "figure",
    { class: css(props(codeBlockStyles.figure)) },
    [
      "pre",
      {
        "data-nyte-code": "",
        class: css(props(text.code, codeBlockStyles.pre, markdownStyles.pre)),
      },
      ["code", 0],
    ],
  ],
  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^```([^\s`]*)\s$/u,
        type: this.type,
        getAttributes: (match) => ({ info: match[1] ?? "" }),
      }),
    ];
  },
});

const HorizontalRule = Node.create({
  name: "horizontalRule",
  group: "block",
  atom: true,
  addAttributes: () => ({ marker: kept("---") }),
  parseHTML: () => [{ tag: "hr" }],
  renderHTML: () => ["hr", { class: css(props(proseStyles.rule)) }],
  addInputRules() {
    return [nodeInputRule({ find: /^(?:---|\*\*\*|___)\s$/u, type: this.type })];
  },
});

const Table = Node.create({
  name: "table",
  group: "block",
  content: "tableRow+",
  isolating: true,
  addAttributes: () => ({ align: kept([]), aligned: kept(false), delimiter: kept("") }),
  parseHTML: () => [{ tag: "table" }],
  renderHTML: () => [
    "div",
    { "data-nyte-scrollport": "", class: css(props(proseStyles.tableWrap, hairline.ring)) },
    ["table", { class: css(props(proseStyles.table)) }, ["tbody", 0]],
  ],
  addKeyboardShortcuts: () => ({
    Tab: ({ editor }) => goToNextCell(1)(editor.state, editor.view.dispatch),
    "Shift-Tab": ({ editor }) => goToNextCell(-1)(editor.state, editor.view.dispatch),
  }),
  addProseMirrorPlugins: () => [tableEditing()],
});

const TableRow = Node.create({
  name: "tableRow",
  content: "(tableHeader | tableCell)+",
  addAttributes: () => ({ inlineOrigin: sourceIndex }),
  parseHTML: () => [{ tag: "tr" }],
  renderHTML: () => ["tr", 0],
});

const cellAttributes = () => ({
  colspan: kept(1),
  rowspan: kept(1),
  colwidth: kept(null),
  align: kept(null),
  inlineOrigin: sourceIndex,
});

const cellStyle = (align: unknown): Record<string, string> =>
  align === "left" || align === "right" || align === "center"
    ? { style: `text-align: ${align}` }
    : {};

const TableHeader = Node.create({
  name: "tableHeader",
  content: "inline*",
  isolating: true,
  addAttributes: cellAttributes,
  parseHTML: () => [{ tag: "th" }],
  renderHTML: ({ node }) => [
    "th",
    {
      ...cellStyle(node.attrs["align"]),
      class: css(props(proseStyles.cell, hairline.tableCell, proseStyles.headerCell)),
    },
    0,
  ],
});

const TableCell = Node.create({
  name: "tableCell",
  content: "inline*",
  isolating: true,
  addAttributes: cellAttributes,
  parseHTML: () => [{ tag: "td" }],
  renderHTML: ({ node }) => [
    "td",
    { ...cellStyle(node.attrs["align"]), class: css(props(proseStyles.cell, hairline.tableCell)) },
    0,
  ],
});

/** The roles prosemirror-tables reads from the schema. */
const TABLE_ROLES = new Map([
  ["table", "table"],
  ["tableRow", "row"],
  ["tableHeader", "header_cell"],
  ["tableCell", "cell"],
]);

const TableRoles = Extension.create({
  name: "tableRoles",
  extendNodeSchema: (extension) => ({ tableRole: TABLE_ROLES.get(extension.name) }),
});

export const MarkdownImage = Node.create({
  name: "image",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({
    src: {
      default: "",
      rendered: false,
      parseHTML: (element) =>
        element.getAttribute("data-markdown-src") ?? element.getAttribute("src"),
    },
    alt: { default: "", rendered: false, parseHTML: (element) => element.getAttribute("alt") },
    title: {
      default: null,
      rendered: false,
      parseHTML: (element) => element.getAttribute("title"),
    },
    raw: kept(null),
  }),
  parseHTML: () => [{ tag: "img[data-markdown-src]" }, { tag: "img[src]" }],
  renderHTML: ({ node }) => [
    "img",
    { "data-markdown-src": String(node.attrs["src"]), alt: String(node.attrs["alt"]) },
  ],
});

const HardBreak = Node.create({
  name: "hardBreak",
  group: "inline",
  inline: true,
  selectable: false,
  addAttributes: () => ({ marker: kept("\\") }),
  parseHTML: () => [{ tag: "br" }],
  renderHTML: () => ["br"],
  renderText: () => "\n",
  addKeyboardShortcuts() {
    return { "Shift-Enter": () => this.editor.commands.insertContent({ type: this.name }) };
  },
});

/** A source line break inside a paragraph, which reads as a space. */
const SoftBreak = Node.create({
  name: "softBreak",
  group: "inline",
  inline: true,
  selectable: false,
  renderHTML: () => ["span", " "],
  renderText: () => " ",
});

/** Markdown the editor can't model (HTML, footnotes, link definitions), kept as written. */
const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  addAttributes: () => ({ kind: kept("html"), source: kept("") }),
  renderHTML: ({ node }) => [
    "pre",
    {
      "data-markdown-raw": String(node.attrs["kind"]),
      class: css(props(text.code, markdownStyles.raw)),
    },
    String(node.attrs["source"]),
  ],
});

const RawInline = Node.create({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes: () => ({ source: kept("") }),
  renderHTML: ({ node }) => [
    "code",
    { class: css(props(markdownStyles.rawInline)) },
    String(node.attrs["source"]),
  ],
  renderText: ({ node }) => String(node.attrs["source"]),
});

export const MarkdownLink = Mark.create({
  name: "link",
  priority: 1100,
  inclusive: false,
  addAttributes: () => ({
    href: { default: "", rendered: false, parseHTML: (element) => element.getAttribute("href") },
    title: kept(null),
    open: kept("["),
    close: kept(null),
  }),
  parseHTML: () => [{ tag: "a[href]" }],
  renderHTML: ({ mark }) => [
    "a",
    {
      href: String(mark.attrs["href"]),
      title: String(mark.attrs["href"]),
      class: css(props(proseStyles.link, proseStyles.webLink)),
    },
    0,
  ],
});

const Bold = Mark.create({
  name: "bold",
  addAttributes: () => ({ marker: kept("**") }),
  parseHTML: () => [{ tag: "strong" }, { tag: "b" }],
  renderHTML: () => ["strong", { class: css(props(proseStyles.strong)) }, 0],
  addKeyboardShortcuts() {
    return { "Mod-b": () => this.editor.commands.toggleMark(this.name) };
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(\*\*(?!\s)([^*]+)(?<!\s)\*\*)$/u, type: this.type })];
  },
});

const Italic = Mark.create({
  name: "italic",
  addAttributes: () => ({ marker: kept("*") }),
  parseHTML: () => [{ tag: "em" }, { tag: "i" }],
  renderHTML: () => ["em", 0],
  addKeyboardShortcuts() {
    return { "Mod-i": () => this.editor.commands.toggleMark(this.name) };
  },
  addInputRules() {
    return [
      markInputRule({ find: /(?:^|\s)(\*(?![\s*])([^*]+)(?<!\s)\*)$/u, type: this.type }),
      markInputRule({
        find: /(?:^|\s)(_(?![\s_])([^_]+)(?<!\s)_)$/u,
        type: this.type,
        getAttributes: () => ({ marker: "_" }),
      }),
    ];
  },
});

const Strike = Mark.create({
  name: "strike",
  addAttributes: () => ({ marker: kept("~~") }),
  parseHTML: () => [{ tag: "s" }, { tag: "del" }],
  renderHTML: () => ["s", 0],
  addKeyboardShortcuts() {
    return { "Mod-Shift-s": () => this.editor.commands.toggleMark(this.name) };
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(~~(?!\s)([^~]+)(?<!\s)~~)$/u, type: this.type })];
  },
});

const Code = Mark.create({
  name: "code",
  priority: 50,
  code: true,
  addAttributes: () => ({ ticks: kept(1), padded: kept(false) }),
  parseHTML: () => [{ tag: "code" }],
  renderHTML: () => ["code", { class: css(props(proseStyles.inlineCode)) }, 0],
  addKeyboardShortcuts() {
    return { "Mod-e": () => this.editor.commands.toggleMark(this.name) };
  },
  addInputRules() {
    return [markInputRule({ find: /(?:^|[^`])(`([^`]+)`)$/u, type: this.type })];
  },
});

const History = Extension.create({
  name: "markdownHistory",
  addProseMirrorPlugins: () => [history()],
  addKeyboardShortcuts: () => ({
    "Mod-z": ({ editor }) => undo(editor.state, editor.view.dispatch),
    "Mod-Shift-z": ({ editor }) => redo(editor.state, editor.view.dispatch),
    "Mod-y": ({ editor }) => redo(editor.state, editor.view.dispatch),
  }),
});

const Origin = Extension.create({
  name: "markdownOrigin",
  addGlobalAttributes: () => [
    {
      types: [
        "paragraph",
        "heading",
        "blockquote",
        "bulletList",
        "orderedList",
        "codeBlock",
        "horizontalRule",
        "table",
        "rawBlock",
      ],
      attributes: { origin: sourceIndex },
    },
  ],
});

/** Node views that need React are added by the editor. */
export const markdownExtensions: Extensions = [
  Doc,
  Text,
  Paragraph,
  Heading,
  Blockquote,
  BulletList,
  OrderedList,
  ListItem,
  MarkdownCodeBlock,
  HorizontalRule,
  Table,
  TableRow,
  TableHeader,
  TableCell,
  TableRoles,
  MarkdownImage,
  HardBreak,
  SoftBreak,
  RawBlock,
  RawInline,
  MarkdownLink,
  Bold,
  Italic,
  Strike,
  Code,
  History,
  Origin,
];
