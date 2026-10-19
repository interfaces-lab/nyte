/** The 4×4 ordered-dither matrix the site's moon uses. */
export const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

export const palette = {
  ink: "#03030f",
  dusk: "#0a0a3a",
  top: "#0a0a6e",
  blue: "#2222dd",
  lift: "#4a5af2",
  haze: "#aab4ff",
  plateInk: "#0e0e5c",
  white: "#f6f6ff",
  pink: "#ffd6e8",
  violet: "#e3dcff",
  cyan: "#c8f3ff",
} as const;

const masks = new Map<string, string>();

/**
 * A CSS mask that shows the cells of one 4×4 Bayer tile whose threshold is
 * below `level` (0 to 16). Stepping the level dissolves anything it masks in
 * the same ordered pattern the moon is drawn with.
 */
export function ditherMask(level: number, cell: number) {
  const key = `${level}:${cell}`;
  const cached = masks.get(key);

  if (cached) return cached;

  const rects = bayer
    .map((threshold, index) =>
      threshold < level
        ? `<rect x='${(index % 4) * cell}' y='${Math.floor(index / 4) * cell}' width='${cell}' height='${cell}'/>`
        : "",
    )
    .join("");

  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${cell * 4}' height='${cell * 4}'>${rects}</svg>`;
  const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  masks.set(key, mask);

  return mask;
}

/** Inline style that dithers an element in at `progress` (0 hidden, 1 whole). */
export function ditherStyle(progress: number, cell = 3) {
  const level = Math.round(Math.min(Math.max(progress, 0), 1) * 16);

  if (level >= 16) return {};

  if (level <= 0) return { visibility: "hidden" } as const;

  const mask = ditherMask(level, cell);

  return {
    maskImage: mask,
    WebkitMaskImage: mask,
    maskSize: `${cell * 4}px ${cell * 4}px`,
    WebkitMaskSize: `${cell * 4}px ${cell * 4}px`,
  };
}

interface MoonProps {
  readonly cells: number;
  readonly pixel: number;
  /** 0 is full; π/2 is a half moon lit from the left; near π is a thin crescent. */
  readonly phase: number;
  /** How much of the disc has resolved, for growing the moon cell by cell. */
  readonly reveal?: number;
  readonly color?: string;
  readonly earthshine?: number;
  /** Leave a hairline between cells, as the landing moon does at full size. */
  readonly gap?: boolean;
}

/**
 * DitherMoon from the landing plate with a moving light, so the film can turn
 * the moon through its phases over one night.
 */
export function Moon({
  cells,
  pixel,
  phase,
  reveal = 1,
  color = palette.white,
  earthshine = 0.2,
  gap = true,
}: MoonProps) {
  const radius = cells / 2;
  const square = gap ? pixel - 1 : pixel;

  const light = {
    x: -Math.sin(phase) * 0.92,
    y: -0.32 * Math.sin(phase) - 0.12,
    z: Math.cos(phase),
  };

  const length = Math.hypot(light.x, light.y, light.z);
  let lit = "";
  let shadow = "";

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const nx = (x + 0.5 - radius) / radius;
      const ny = (y + 0.5 - radius) / radius;
      const depth = 1 - nx * nx - ny * ny;

      if (depth <= 0) continue;

      const threshold = bayer[(y % 4) * 4 + (x % 4)];
      const distance = Math.hypot(nx, ny);

      if (reveal < 1 && distance + threshold / 64 > reveal * 1.25) continue;

      const shade = (light.x * nx + light.y * ny + light.z * Math.sqrt(depth)) / length;
      const cell = `M${x * pixel} ${y * pixel}h${square}v${square}h-${square}z`;

      if (shade * 18 > threshold + 0.5) lit += cell;
      else shadow += cell;
    }
  }

  const size = cells * pixel;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      fill={color}
      shapeRendering="crispEdges"
      style={{ display: "block", overflow: "visible" }}
    >
      <path d={shadow} opacity={earthshine} />
      <path d={lit} />
    </svg>
  );
}
