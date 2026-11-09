import type { Node, Query, QueryMatch, Tree } from "web-tree-sitter";
import type {
  CodeFoldRegion,
  FileStructureData,
  RangedOutlineSymbol,
  SourceLineSpan,
} from "./file-structure.ts";

export function parseFileStructure(input: {
  readonly contents: string;
  readonly tree: Tree;
  readonly folds: Query;
  readonly symbols?: Query;
}): FileStructureData {
  const candidates = input.symbols?.matches(input.tree.rootNode).flatMap(readSymbol) ?? [];

  const functions = new Set(
    candidates.filter((symbol) => symbol.kind === "function").map((symbol) => symbol.nodeId),
  );

  const seen = new Set<number>();

  const declarations = candidates
    .filter((symbol) => symbol.kind !== "variable" || !functions.has(symbol.nodeId))
    .filter((symbol) => {
      if (seen.has(symbol.nodeId)) return false;
      seen.add(symbol.nodeId);

      return true;
    })
    .toSorted(
      (left, right) => left.startIndex - right.startIndex || right.endIndex - left.endIndex,
    );

  const parents: typeof declarations = [];

  const symbols = declarations.map((declaration): RangedOutlineSymbol => {
    while (parents.length > 0) {
      const parent = parents.at(-1);

      if (
        parent !== undefined &&
        parent.startIndex <= declaration.startIndex &&
        parent.endIndex >= declaration.endIndex &&
        (parent.startIndex < declaration.startIndex || parent.endIndex > declaration.endIndex)
      )
        break;
      parents.pop();
    }

    const symbol = {
      name: declaration.name,
      kind: declaration.kind,
      line: declaration.line,
      endLine: declaration.endLine,
      depth: parents.length,
    };

    parents.push(declaration);

    return symbol;
  });

  return {
    contents: input.contents,
    folds: input.folds
      .matches(input.tree.rootNode)
      .flatMap(readFold)
      .toSorted(
        (left, right) =>
          left.headerLine - right.headerLine || right.hidden.endLine - left.hidden.endLine,
      ),
    symbols,
  };
}

function sourceSpan(node: Node): SourceLineSpan {
  return {
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + (node.endPosition.column === 0 ? 1 : 2),
  };
}

function readFold(match: QueryMatch): CodeFoldRegion[] {
  const selected = match.captures.find((capture) =>
    [
      "fold.delimited",
      "fold.indented",
      "fold.markup",
      "fold.comment",
      "fold.section",
      "fold.key",
      "fold.tail",
      "fold.heredoc",
    ].includes(capture.name),
  );

  if (selected === undefined || selected.node.hasError) return [];
  const node = selected.node;
  const open = match.captures.find((capture) => capture.name === "fold.open")?.node;
  const close = match.captures.find((capture) => capture.name === "fold.close")?.node;
  const heading = match.captures.find((capture) => capture.name === "fold.header")?.node;
  const value = match.captures.find((capture) => capture.name === "fold.value")?.node;
  const body = match.captures.find((capture) => capture.name === "fold.body")?.node;

  if (selected.name === "fold.indented") {
    const parent = node.parent;

    if (parent === null || parent.hasError) return [];

    return foldRegion(
      parent.startPosition.row + 1,
      sourceSpan(parent),
      {
        startLine: Math.max(parent.startPosition.row + 2, node.startPosition.row + 1),
        endLine: sourceSpan(node).endLine,
      },
      "code",
    );
  }

  if (selected.name === "fold.section" && heading !== undefined)
    return foldRegion(
      heading.startPosition.row + 1,
      sourceSpan(node),
      {
        startLine: sourceSpan(heading).endLine,
        endLine: sourceSpan(node).endLine,
      },
      "section",
    );

  if (selected.name === "fold.key" && value !== undefined)
    return foldRegion(
      node.startPosition.row + 1,
      sourceSpan(node),
      {
        startLine: Math.max(
          node.startPosition.row + 2,
          value.startPosition.row + (value.type === "block_scalar" ? 2 : 1),
        ),
        endLine: sourceSpan(value).endLine,
      },
      "code",
    );

  if (selected.name === "fold.tail")
    return foldRegion(
      node.startPosition.row + 1,
      sourceSpan(node),
      {
        startLine: node.startPosition.row + 2,
        endLine: sourceSpan(node).endLine,
      },
      "code",
    );

  if (selected.name === "fold.comment")
    return foldRegion(
      node.startPosition.row + 1,
      sourceSpan(node),
      {
        startLine: node.startPosition.row + 2,
        endLine: sourceSpan(node).endLine - 1,
      },
      "comment",
    );

  if (
    selected.name === "fold.heredoc" &&
    open !== undefined &&
    close !== undefined &&
    body !== undefined
  )
    return foldRegion(
      open.startPosition.row + 1,
      sourceSpan(node),
      {
        startLine: body.startPosition.row + 1,
        endLine: close.startPosition.row + 1,
      },
      "literal",
    );

  if (selected.name === "fold.markup" && open !== undefined && close !== undefined)
    return foldRegion(
      node.startPosition.row + 1,
      sourceSpan(node),
      {
        startLine: sourceSpan(open).endLine,
        endLine: close.startPosition.row + 1,
      },
      node.type === "string" || node.type === "fenced_code_block" ? "literal" : "code",
    );

  if (selected.name !== "fold.delimited") return [];

  const first = node.children.find(
    (child) =>
      child !== null && !child.isNamed && ["{", "[", "(", "do", "then", "in"].includes(child.type),
  );

  const last = node.children.findLast(
    (child) =>
      child !== null &&
      !child.isNamed &&
      ["}", "]", ")", "done", "fi", "esac"].includes(child.type),
  );

  if (
    first === undefined ||
    first === null ||
    last === undefined ||
    last === null ||
    first.isMissing ||
    last.isMissing
  )
    return [];
  const parent = node.parent;

  const owner =
    parent !== null &&
    (["body", "consequence", "alternative"].some(
      (field) => parent.childForFieldName(field)?.id === node.id,
    ) ||
      ["rule_set", "media_statement"].includes(parent.type))
      ? parent
      : node;

  return foldRegion(
    owner.startPosition.row + 1,
    sourceSpan(owner),
    {
      startLine: sourceSpan(first).endLine,
      endLine: last.startPosition.row + 1,
    },
    "code",
  );
}

function foldRegion(
  headerLine: number,
  range: SourceLineSpan,
  hidden: SourceLineSpan,
  kind: CodeFoldRegion["kind"],
): CodeFoldRegion[] {
  if (headerLine >= hidden.startLine || hidden.startLine >= hidden.endLine) return [];

  return [{ headerLine, range, hidden, kind }];
}

function readSymbol(match: QueryMatch): (Omit<RangedOutlineSymbol, "depth"> & {
  readonly nodeId: number;
  readonly startIndex: number;
  readonly endIndex: number;
})[] {
  const selected = match.captures.find((capture) => capture.name.startsWith("symbol."));
  const name = match.captures.find((capture) => capture.name === "name");

  if (selected === undefined || name === undefined || selected.node.hasError) return [];
  const node = selected.node;
  const kind = selected.name.slice("symbol.".length);

  if (
    kind !== "function" &&
    kind !== "class" &&
    kind !== "type" &&
    kind !== "variable" &&
    kind !== "heading"
  )
    return [];

  if (
    kind === "variable" &&
    node.parent?.parent?.type !== "program" &&
    node.parent?.parent?.type !== "export_statement"
  )
    return [];
  const parent = node.parent;

  const extent =
    parent?.type === "decorated_definition" || parent?.type === "export_statement" ? parent : node;

  return [
    {
      nodeId: node.id,
      startIndex: extent.startIndex,
      endIndex: extent.endIndex,
      name: name.node.text.trim(),
      kind,
      line: extent.startPosition.row + 1,
      endLine: sourceSpan(extent).endLine - 1,
    },
  ];
}
