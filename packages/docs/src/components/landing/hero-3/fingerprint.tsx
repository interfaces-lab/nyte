import { BAYER } from "../plate/dither-moon";

interface FingerprintProps {
  seed: string;
  cols: number;
  rows: number;
  /** Pitch of one cell in px. Each square is one px smaller, leaving a hairline gap. */
  pixel: number;
  className?: string;
}

function hash(text: string): number {
  let h = 2166136261;
  for (const char of text) {
    h ^= char.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* The seeded wave behind a fingerprint: 0 outside the ridges, rising to 1 on them. */
export function fingerprintField(seed: string): (x: number, y: number) => number {
  const next = random(hash(seed));
  const ax = (next() - 0.5) * 0.7;
  const ay = (next() - 0.5) * 0.7;
  const bx = (next() - 0.5) * 0.36;
  const by = (next() - 0.5) * 0.36;
  const phaseA = next() * Math.PI * 2;
  const phaseB = next() * Math.PI * 2;
  const cut = 0.15 + next() * 0.35;
  return (x, y) => {
    const wave = Math.sin(ax * x + ay * y + phaseA) * Math.cos(bx * x + by * y + phaseB);
    return Math.max(0, wave - cut) / (1 - cut);
  };
}

/*
 * Two interfering waves, cut off below a seeded level and ordered-dithered
 * onto a grid: most of the field stays empty, a few ridges go solid, and the
 * slopes between them scatter into lone dots. Every name draws a different
 * shape from the same rules: the same job, implemented again.
 */
export function Fingerprint({ seed, cols, rows, pixel, className }: FingerprintProps) {
  const field = fingerprintField(seed);
  const square = pixel - 1;
  let lit = "";

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (field(x, y) * 16 > BAYER[(y % 4) * 4 + (x % 4)] + 0.5) {
        lit += `M${x * pixel} ${y * pixel}h${square}v${square}h-${square}z`;
      }
    }
  }

  const width = cols * pixel;
  const height = rows * pixel;
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="currentColor"
      shapeRendering="crispEdges"
      className={className}
    >
      <path d={lit} />
    </svg>
  );
}
