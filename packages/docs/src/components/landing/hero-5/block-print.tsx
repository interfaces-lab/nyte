import { AsciiArt } from "./ascii-art";

type Block = readonly [
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  height: number,
];

const ARRANGEMENTS = [
  [
    [0, 0, 0, 4, 3, 1],
    [0, 0, 1, 4, 1, 1],
  ],
  [
    [0, 0, 0, 3, 3, 1],
    [0, 0, 1, 2, 2, 2],
  ],
  [
    [1, 0, 0, 2, 3, 1],
    [0, 1, 1, 4, 1, 1],
  ],
  [
    [0, 0, 0, 2, 3, 1],
    [0, 0, 1, 2, 1, 2],
  ],
  [
    [0, 0, 0, 2, 2, 3],
    [2, 0, 0, 2, 2, 1],
  ],
  [
    [0, 0, 0, 4, 3, 1],
    [0, 1, 1, 4, 2, 1],
    [0, 2, 2, 4, 1, 1],
  ],
  [
    [0, 0, 0, 1, 2, 2],
    [3, 0, 0, 1, 2, 2],
    [0, 0, 2, 4, 2, 1],
  ],
  [
    [0, 0, 0, 3, 1, 2],
    [0, 1, 0, 1, 2, 2],
  ],
] as const satisfies readonly (readonly Block[])[];

const COLS = 28;
const ROWS = 16;

/*
 * Ray-casts each cell against the blocks in isometric view and shades the
 * face it hits, like the harness logos: tops light, left faces mid, right
 * faces dark. A thin light seam runs along every edge so blocks stay apart.
 */
function drawBlocks(blocks: readonly Block[]) {
  const bounds = blocks.flatMap(([x, y, z, width, depth, height]) =>
    [x, x + width].flatMap((px) =>
      [y, y + depth].flatMap((py) =>
        [z, z + height].map((pz) => ({ x: px - py, y: (px + py) / 2 - pz })),
      ),
    ),
  );
  const left = Math.min(...bounds.map((point) => point.x));
  const right = Math.max(...bounds.map((point) => point.x));
  const top = Math.min(...bounds.map((point) => point.y));
  const bottom = Math.max(...bounds.map((point) => point.y));
  const scale = Math.min(((COLS - 1) * 6) / (right - left), ((ROWS - 1) * 10) / (bottom - top));
  const camera = Math.max(...blocks.map(([, , z, , , height]) => z + height)) + 10;
  const edge = 3 / scale;

  return Array.from({ length: ROWS }, (_, row) =>
    Array.from({ length: COLS }, (_, col) => {
      const sx = ((col + 0.5 - COLS / 2) * 6) / scale + (left + right) / 2;
      const sy = ((row + 0.5 - ROWS / 2) * 10) / scale + (top + bottom) / 2;
      const ox = camera + sy + sx / 2;
      const oy = camera + sy - sx / 2;
      let nearest = Infinity;
      let glyph = " ";

      for (const [x, y, z, width, depth, height] of blocks) {
        const tx = ox - x - width;
        const ty = oy - y - depth;
        const tz = camera - z - height;
        const enter = Math.max(tx, ty, tz);
        const leave = Math.min(ox - x, oy - y, camera - z);
        if (enter > leave || enter >= nearest) continue;
        nearest = enter;

        const px = ox - enter - x;
        const py = oy - enter - y;
        const pz = camera - enter - z;
        const xEdge = Math.min(px, width - px) < edge;
        const yEdge = Math.min(py, depth - py) < edge;
        const zEdge = Math.min(pz, height - pz) < edge;

        if (enter === tz) {
          glyph = xEdge || yEdge ? "." : ":";
        } else if (enter === tx) {
          glyph = yEdge || zEdge ? "." : "@";
        } else {
          glyph = xEdge || zEdge ? "." : "%";
        }
      }

      return glyph;
    }).join(""),
  );
}

const PRINTS = ARRANGEMENTS.map(drawBlocks);

export function BlockPrint({ index, className }: { index: number; className?: string }) {
  return <AsciiArt rows={PRINTS[index] ?? []} className={className} />;
}
