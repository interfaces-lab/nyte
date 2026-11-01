/**
 * The moon from the Nyte app icon, cell for cell: lit cells solid, the dither
 * across its dark side faint. Twelve cells across, so it stays crisp at
 * multiples of 12px.
 */
export const moon = [
  "    ###.    ",
  "  ####.#..  ",
  " ########.. ",
  " ###.#.#... ",
  "#######.#...",
  "##.#.#.#....",
  "#####.#.#...",
  ".#.#.#......",
  " ##.#.#.... ",
  " #......... ",
  "  #.......  ",
  "    ....    ",
];

export const moonCells = moon.flatMap((row, y) =>
  row.split("").flatMap((cell, x) => (cell === " " ? [] : [{ x, y, lit: cell === "#" }])),
);

export function DesignMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      aria-hidden="true"
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- React's name for the SVG shape-rendering attribute
      shapeRendering="crispEdges"
      className="design-mark"
    >
      {moonCells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x}
          y={cell.y}
          width="1"
          height="1"
          opacity={cell.lit ? 1 : 0.24}
        />
      ))}
    </svg>
  );
}

/** The site's name, set in the pixel face the Nyte landing uses for its headline. */
export function DesignWordmark() {
  return (
    <span className="design-wordmark">
      <DesignMark />
      <span>Nyte Design</span>
    </span>
  );
}
