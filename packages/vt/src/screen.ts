import type { Screen } from "./index.ts";

export const NO_COLOR = -1;

export const CellFlag = {
  BOLD: 1,
  ITALIC: 2,
  FAINT: 4,
  INVERSE: 8,
  INVISIBLE: 16,
  STRIKETHROUGH: 32,
  OVERLINE: 64,
  CLUSTER: 128,
} as const;

export const UnderlineStyle = {
  NONE: 0,
  SINGLE: 1,
  DOUBLE: 2,
  CURLY: 3,
  DOTTED: 4,
  DASHED: 5,
} as const;

export interface Grid {
  readonly screen: Screen;
  readonly clusters: Map<number, string>;
}

export function createGrid(cols: number, rows: number): Grid {
  const size = cols * rows;
  const glyph = new Uint32Array(size);
  const clusters = new Map<number, string>();

  return {
    clusters,
    screen: {
      cols,
      rows,
      glyph,
      width: new Uint8Array(size).fill(1),
      fg: new Int32Array(size).fill(NO_COLOR),
      bg: new Int32Array(size).fill(NO_COLOR),
      underlineColor: new Int32Array(size).fill(NO_COLOR),
      flags: new Uint8Array(size),
      underline: new Uint8Array(size),
      wrapped: new Uint8Array(rows),
      selectionStart: new Int32Array(rows).fill(-1),
      selectionEnd: new Int32Array(rows).fill(-1),
      hash: new Uint32Array(rows),
      text: (index) => {
        const cluster = clusters.get(index);

        if (cluster !== undefined) return cluster;
        const codepoint = glyph[index] ?? 0;

        return codepoint === 0 ? "" : String.fromCodePoint(codepoint);
      },
    },
  };
}
