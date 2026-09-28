const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;

export const MOON_STATES = [
  "working",
  "thinking",
  "retrying",
  "compacting",
  "waiting",
  "done",
  "failed",
  "stopped",
] as const;

export type MoonState = (typeof MOON_STATES)[number];

/** 0 is empty sky, 1 is earthshine, 2 is lit. */
export type Level = 0 | 1 | 2;

export interface Cell {
  readonly x: number;
  readonly y: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  /** Position in the Bayer matrix, 0 to 15. State changes dissolve in this order. */
  readonly order: number;
}

/** Every cell of a `cells`-wide grid whose centre falls on the disc. */
export function discCells(cells: number): readonly Cell[] {
  const radius = cells / 2;
  const disc: Cell[] = [];

  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const nx = (x + 0.5 - radius) / radius;
      const ny = (y + 0.5 - radius) / radius;
      const depth = 1 - nx * nx - ny * ny;
      if (depth <= 0) continue;
      disc.push({ x, y, nx, ny, nz: Math.sqrt(depth), order: BAYER[(y % 4) * 4 + (x % 4)] });
    }
  }

  return disc;
}

function dither(cell: Cell, shade: number, shift = 0): Level {
  const threshold = BAYER[((cell.y + shift) % 4) * 4 + ((cell.x + shift) % 4)] + 0.5;

  return shade * 16 > threshold ? 2 : 1;
}

/**
 * The sun orbits the moon once per cycle: new at 0, waxing on the right, full at
 * one half, waning on the left. A slight lift from above keeps the terminator
 * from reading as a straight wipe on small grids.
 */
function phase(cell: Cell, cycle: number): number {
  const angle = cycle * Math.PI * 2;

  return Math.sin(angle) * cell.nx - 0.18 * cell.ny - Math.cos(angle) * cell.nz;
}

/** The brand moon: lit from the upper left, as on the download tile. */
function brand(cell: Cell): number {
  return -0.62 * cell.nx - 0.5 * cell.ny + 0.6 * cell.nz;
}

const wrap = (value: number) => value - Math.floor(value);

/** `t` is seconds since the state began. */
export function moonLevel(state: MoonState, cell: Cell, t: number, cells: number): Level {
  switch (state) {
    case "working":
      return dither(cell, phase(cell, wrap(t / 1.6)));
    case "thinking":
      // The light holds still and the dither itself drifts, so the face shimmers.
      return dither(cell, brand(cell) * 0.9, Math.floor(t * 7) % 4);
    case "retrying": {
      // Half a cycle forward, then a quick rewind: an attempt, and another.
      const beat = wrap(t / 1.1);
      const cycle = beat < 0.7 ? 0.1 + (beat / 0.7) * 0.4 : 0.5 - ((beat - 0.7) / 0.3) * 0.4;

      return dither(cell, phase(cell, cycle));
    }
    case "compacting": {
      const reach = 0.42 + 0.58 * (0.5 + 0.5 * Math.cos(t * Math.PI * 1.4));
      const distance = Math.hypot(cell.nx, cell.ny);
      if (distance > reach + 1 / cells) return 0;

      return dither(cell, 0.35 + brand(cell) * 0.5);
    }
    case "waiting": {
      // First quarter, with one cell on the terminator blinking like a caret.
      const level = dither(cell, phase(cell, 0.25));
      const middle = Math.floor(cells / 2);
      if (cell.x !== middle || cell.y !== middle) return level;

      return wrap(t / 1.1) < 0.55 ? 2 : 1;
    }
    case "done":
      return dither(cell, 0.3 + 0.7 * cell.nz);
    case "failed": {
      // An eclipse that stops short: the shadow leaves a lit rim on one side.
      const shadow = Math.hypot(cell.nx + 0.28, cell.ny + 0.2) < 0.86;

      return shadow ? 1 : dither(cell, 0.9);
    }
    case "stopped":
      return 1;
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

/**
 * A change of state lands one Bayer rank at a time, so the new lighting arrives
 * as an even scatter rather than a wipe. `progress` runs from 0 to 1.
 */
export function dissolve(from: Level, to: Level, cell: Cell, progress: number): Level {
  return cell.order < progress * 16 ? to : from;
}
