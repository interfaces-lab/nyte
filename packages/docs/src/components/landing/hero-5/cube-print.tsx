import { AsciiArt } from "./ascii-art";
import { fingerprintField } from "../hero-3/fingerprint";

const CELLS = 5;
const COLS = 44;
const ROWS = 28;
const HALF_WIDTH = 4;
const HALF_HEIGHT = 2;
const DEPTH = 4;

export function CubePrint({ seed, className }: { seed: string; className?: string }) {
  const field = fingerprintField(seed);
  const cubes: { x: number; y: number; z: number }[] = [];
  const raster = Array.from({ length: ROWS }, () => Array<string>(COLS).fill(" "));

  for (let y = 0; y < CELLS; y++) {
    for (let x = 0; x < CELLS; x++) {
      const value = field(x * 8, y * 8);
      if (value < 0.18) continue;
      const height = value > 0.65 ? 2 : 1;
      for (let z = 0; z < height; z++) cubes.push({ x, y, z });
    }
  }

  if (cubes.length === 0) cubes.push({ x: 2, y: 2, z: 0 });
  cubes.sort((a, b) => a.x + a.y - (b.x + b.y) || a.z - b.z);

  for (const { x, y, z } of cubes) {
    const cx = COLS / 2 + (x - y) * HALF_WIDTH;
    const cy = 7 + (x + y) * HALF_HEIGHT - z * DEPTH;
    for (let dy = -HALF_HEIGHT; dy < HALF_HEIGHT + DEPTH; dy++) {
      for (let dx = -HALF_WIDTH; dx < HALF_WIDTH; dx++) {
        const slope = Math.abs(dx + 0.5) / 2;
        const row = raster[cy + dy];
        if (!row) continue;
        const py = dy + 0.5;
        if (py >= -HALF_HEIGHT + slope && py < HALF_HEIGHT - slope) {
          row[cx + dx] = (dx + dy) % 3 === 0 ? "@" : "#";
        } else if (py >= HALF_HEIGHT - slope && py < HALF_HEIGHT - slope + DEPTH) {
          row[cx + dx] = dx < 0 ? "+" : ":";
        }
      }
    }
  }

  return <AsciiArt rows={raster.map((row) => row.join(""))} className={className} />;
}
