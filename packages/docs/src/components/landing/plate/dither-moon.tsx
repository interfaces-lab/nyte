const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

interface DitherMoonProps {
  cells: number;
  /** Pitch of one cell in px. Each square is one px smaller, leaving a hairline gap. */
  pixel: number;
  className?: string;
}

/*
 * A sphere lit from the upper left, ordered-dithered onto a square grid. Cells
 * the light misses stay as faint earthshine so the disc keeps its outline.
 */
export function DitherMoon({ cells, pixel, className }: DitherMoonProps) {
  const radius = cells / 2;
  const square = pixel - 1;
  let lit = "";
  let shadow = "";

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const nx = (x + 0.5 - radius) / radius;
      const ny = (y + 0.5 - radius) / radius;
      const depth = 1 - nx * nx - ny * ny;
      if (depth <= 0) continue;
      const shade = -0.62 * nx - 0.5 * ny + 0.6 * Math.sqrt(depth);
      const cell = `M${x * pixel} ${y * pixel}h${square}v${square}h-${square}z`;
      if (shade * 16 > BAYER[(y % 4) * 4 + (x % 4)] + 0.5) lit += cell;
      else shadow += cell;
    }
  }

  const size = cells * pixel;
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      className={className}
    >
      <path d={shadow} opacity={0.22} />
      <path d={lit} />
    </svg>
  );
}
