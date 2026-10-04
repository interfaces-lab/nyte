const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

const PITCH = 4;
const LINE = 1.4;
const DASH = 3;

/*
 * DitherMoon's sphere drawn as scanlines. Each row breaks into dashes only
 * near the terminator, where the ordered threshold flips between light and
 * earthshine.
 */
export function ScanMoon({ rows, className }: { rows: number; className?: string }) {
  const size = rows * PITCH;
  const radius = size / 2;
  let lit = "";
  let shadow = "";

  for (let row = 0; row < rows; row++) {
    const top = row * PITCH + (PITCH - LINE) / 2;
    const ny = (top + LINE / 2 - radius) / radius;
    let start = 0;
    let lighted: boolean | null = null;

    for (let x = 0; x <= size; x++) {
      const nx = (x + 0.5 - radius) / radius;
      const depth = 1 - nx * nx - ny * ny;
      const shade = -0.62 * nx - 0.5 * ny + 0.6 * Math.sqrt(Math.max(depth, 0));
      const next =
        depth <= 0
          ? null
          : (shade - 0.3) * 40 > BAYER[(row % 4) * 4 + (Math.floor(x / DASH) % 4)] + 0.5;
      if (next === lighted) continue;
      const run = `M${start} ${top}h${x - start}v${LINE}h${start - x}z`;
      if (lighted === true) lit += run;
      if (lighted === false) shadow += run;
      start = x;
      lighted = next;
    }
  }

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${size} ${size}`}
      fill="currentColor"
      className={className}
    >
      <path d={shadow} opacity={0.12} />
      <path d={lit} />
    </svg>
  );
}
