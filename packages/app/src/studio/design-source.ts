import { Language, Parser } from "web-tree-sitter";
import type { Node } from "web-tree-sitter";
import { fileStructureAssets, runtimeUrl } from "../workbench/editor/file-structure-assets.ts";

export interface Range {
  readonly start: number;
  readonly end: number;
}

/** One JSX element of a design file, with every offset into the file's text in UTF-16 code units. */
export interface DesignElement extends Range {
  /** Where a `data-src` stamp goes: just after the element's name. */
  readonly stampAt: number;
  /** A DOM element (`<div>`), as opposed to a component instance (`<Button>`). */
  readonly host: boolean;
  /** The element's words, trimmed, when its children are literal text and nothing else. */
  readonly words: Range | null;
  /** The value of a literal `data-x` or `data-y`, inside its quotes or braces. */
  readonly x: Range | null;
  readonly y: Range | null;
  readonly frame: boolean;
  /** The element names its own `data-theme`, so the board's Day/Night leaves it alone. */
  readonly pinned: boolean;
}

export interface DesignSource {
  readonly elements: readonly DesignElement[];
  /** The module specifiers it imports, as written. */
  readonly imports: readonly string[];
  /** It has a default export: the board draws its frames as a sheet. */
  readonly sheet: boolean;
}

let parser: Promise<Parser> | undefined;

const read = new Map<string, { readonly text: string; readonly source: DesignSource }>();

/**
 * Reads a design file's JSX with the JavaScript grammar the editor already ships. The parse only reads the text;
 * nothing in it runs. The last parse of each path is kept, so asking again about unchanged text costs nothing.
 */
export async function parseDesign(path: string, text: string): Promise<DesignSource> {
  const known = read.get(path);

  if (known?.text === text) return known.source;
  const ready = await (parser ??= loadParser());
  const tree = ready.parse(text);

  if (tree === null) throw new Error(`${path} could not be parsed.`);

  try {
    const root = tree.rootNode;

    const source = {
      elements: [...root.descendantsOfType(["jsx_element", "jsx_self_closing_element"])].flatMap(
        (node) => {
          const element = node === null ? undefined : readElement(node, text);

          return element === undefined ? [] : [element];
        },
      ),
      imports: root.descendantsOfType("import_statement").flatMap((node) => {
        const specifier = node?.childForFieldName("source")?.namedChildren[0]?.text;

        return specifier === undefined ? [] : [specifier];
      }),
      sheet: root.children.some(
        (node) =>
          node?.type === "export_statement" &&
          (node.children.some((child) => child?.type === "default") ||
            node
              .descendantsOfType("export_specifier")
              .some((child) => child?.children.some((part) => part?.text === "default"))),
      ),
    };

    read.set(path, { text, source });

    return source;
  } finally {
    tree.delete();
  }
}

async function loadParser(): Promise<Parser> {
  const runtime = await fetchBytes(runtimeUrl);
  await Parser.init({ wasmBinary: runtime });
  const grammar = await Language.load(await fetchBytes(fileStructureAssets.javascript.wasm));
  const next = new Parser();
  next.setLanguage(grammar);

  return next;
}

async function fetchBytes(url: string): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);

  if (!response.ok) throw new Error(`Could not load the design parser: ${String(response.status)}`);

  return new Uint8Array(await response.arrayBuffer());
}

function readElement(node: Node, text: string): DesignElement | undefined {
  const opening = node.type === "jsx_element" ? node.childForFieldName("open_tag") : node;
  const name = opening?.childForFieldName("name");

  if (opening === null || name === null || name === undefined) return undefined;
  const attributes = opening.childrenForFieldName("attribute").filter((child) => child !== null);

  const attribute = (wanted: string): Node | undefined =>
    attributes.find(
      (child) => child.type === "jsx_attribute" && child.namedChildren[0]?.text === wanted,
    );

  return {
    start: node.startIndex,
    end: node.endIndex,
    stampAt: name.endIndex,
    host: name.type === "identifier" && /^[a-z]/u.test(name.text),
    words: node.type === "jsx_element" ? readWords(node, text) : null,
    x: readLiteral(attribute("data-x")),
    y: readLiteral(attribute("data-y")),
    frame: attribute("data-frame") !== undefined,
    pinned: attribute("data-theme") !== undefined,
  };
}

function readWords(node: Node, text: string): Range | null {
  const open = node.childForFieldName("open_tag");
  const close = node.childForFieldName("close_tag");

  if (open === null || close === null) return null;

  const inner = node.children.filter(
    (child) =>
      child !== null && child.startIndex >= open.endIndex && child.endIndex <= close.startIndex,
  );

  if (
    !inner.every(
      (child) => child?.type === "jsx_text" || child?.type === "html_character_reference",
    )
  )
    return null;
  const between = text.slice(open.endIndex, close.startIndex);
  const lead = between.length - between.trimStart().length;
  const trail = between.length - between.trimEnd().length;

  if (between.trim() === "") return null;

  return { start: open.endIndex + lead, end: close.startIndex - trail };
}

function readLiteral(attribute: Node | undefined): Range | null {
  const value = attribute?.namedChildren[1];

  if (value === null || value === undefined) return null;

  if (value.type === "string") {
    const fragment = value.namedChildren[0];

    return fragment === null || fragment === undefined || !/^-?\d+$/u.test(fragment.text)
      ? null
      : { start: fragment.startIndex, end: fragment.endIndex };
  }

  const number = value.type === "jsx_expression" ? value.namedChildren[0] : null;

  return (number?.type === "number" || number?.type === "unary_expression") &&
    value.namedChildren.length === 1 &&
    /^-?\d+$/u.test(number.text)
    ? { start: number.startIndex, end: number.endIndex }
    : null;
}
