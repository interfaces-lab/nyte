import type { SourceLineSpan } from "@pierre/diffs";
import type { OutlineSymbol } from "./outline.ts";

export interface CodeFoldRegion {
  readonly headerLine: number;
  readonly range: SourceLineSpan;
  readonly hidden: SourceLineSpan;
  readonly kind: "code" | "comment" | "section" | "literal";
}

export interface RangedOutlineSymbol extends OutlineSymbol {
  readonly endLine: number;
}

export interface FileStructureData {
  readonly contents: string;
  readonly folds: readonly CodeFoldRegion[];
  readonly symbols: readonly RangedOutlineSymbol[];
}

export interface FileStructure extends FileStructureData {
  symbolAt(line: number | undefined): RangedOutlineSymbol | undefined;
}

export function createFileStructure(data: FileStructureData): FileStructure {
  const symbols = Object.freeze(data.symbols.map((symbol) => Object.freeze({ ...symbol })));

  const folds = Object.freeze(
    data.folds.map((fold) =>
      Object.freeze({
        ...fold,
        range: Object.freeze({ ...fold.range }),
        hidden: Object.freeze({ ...fold.hidden }),
      }),
    ),
  );

  const active = new Set<RangedOutlineSymbol>();

  const events = symbols
    .flatMap((symbol) => [
      { line: symbol.line, symbol, start: true },
      { line: symbol.endLine + 1, symbol, start: false },
    ])
    .toSorted((left, right) => left.line - right.line);

  const index = events.flatMap((event, offset) => {
    if (event.start) active.add(event.symbol);
    else active.delete(event.symbol);

    if (events[offset + 1]?.line === event.line) return [];
    let current: RangedOutlineSymbol | undefined;

    for (const symbol of active) {
      if (
        current === undefined ||
        symbol.depth > current.depth ||
        (symbol.depth === current.depth && symbol.line > current.line) ||
        (symbol.depth === current.depth &&
          symbol.line === current.line &&
          symbol.endLine < current.endLine)
      )
        current = symbol;
    }

    return [{ line: event.line, symbol: current }];
  });

  return Object.freeze({
    contents: data.contents,
    folds,
    symbols,
    symbolAt(line: number | undefined) {
      if (line === undefined || !Number.isInteger(line) || line < 1) return undefined;
      let start = 0;
      let end = index.length;

      while (start < end) {
        const middle = Math.floor((start + end) / 2);
        const entry = index[middle];

        if (entry !== undefined && entry.line <= line) start = middle + 1;
        else end = middle;
      }

      return index[start - 1]?.symbol;
    },
  });
}
