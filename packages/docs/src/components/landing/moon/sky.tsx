import { mulberry } from "./moon-surface";
import { SkyLight } from "./sky-light";
import { CELL_H, CELL_W, SKY_COLS, SKY_ROWS, skyBox, skyLayer } from "./sky-layer";

/*
 * The whole night as text, built once on the server. Every cell holds a
 * glyph: a quiet field of dust everywhere, thickening into the Milky Way along
 * a bowed diagonal band with a dust lane just off its centre. Stars are spread
 * evenly in two layers that twinkle by opacity alone, and a lens that follows
 * the pointer shows the dust brighter. Dark mode keeps only the stars. Cells
 * are 6.67 by 13 px, so the field is ~2900 by 1610, enough to fill tall and
 * wide screens.
 */

const DUST = ".,'`.:.,";
const BAND = [":", ";", "-", "=", "+", "*"];

function buildSky() {
  const random = mulberry(19);
  const grid = Array.from({ length: SKY_ROWS }, () => Array<string>(SKY_COLS).fill(" "));
  const twinkleA = Array.from({ length: SKY_ROWS }, () => Array<string>(SKY_COLS).fill(" "));
  const twinkleB = Array.from({ length: SKY_ROWS }, () => Array<string>(SKY_COLS).fill(" "));
  const width = SKY_COLS * CELL_W;
  const height = SKY_ROWS * CELL_H;

  for (let row = 0; row < SKY_ROWS; row++) {
    for (let col = 0; col < SKY_COLS; col++) {
      const u = (col * CELL_W) / width;
      const v = (row * CELL_H) / height;
      const t = (u + 0.15) / 1.3;
      const centre = 1.05 - 1.1 * t + 0.18 * Math.sin(t * Math.PI);
      /* Distance across the band, corrected for the band's slope. */
      const across = (v - centre) * 0.72;
      const clump = (0.5 + 0.5 * Math.sin(9 * t + 1.7)) * (0.5 + 0.5 * Math.sin(23 * t + 0.4));
      const lane = 1 - 0.8 * Math.exp(-(((across - 0.012) / 0.016) ** 2));
      const band = Math.exp(-((across / 0.085) ** 2)) * (0.35 + 0.65 * clump) * lane;

      const weight = band * (0.55 + 0.45 * random()) + random() * 0.12;
      const star = random() < 0.01;
      if (star) {
        (random() < 0.5 ? twinkleA : twinkleB)[row][col] = "*";
        continue;
      }
      grid[row][col] =
        weight > 0.2
          ? BAND[Math.min(BAND.length - 1, Math.floor((weight - 0.2) * 9))]
          : DUST[Math.floor(random() * DUST.length)];
    }
  }
  const text = (rows: string[][]) => rows.map((line) => line.join("").trimEnd()).join("\n");
  return { base: text(grid), twinkleA: text(twinkleA), twinkleB: text(twinkleB) };
}

const SKY = buildSky();

export function Sky() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <pre className={`${skyLayer} opacity-[0.11] dark:hidden`} style={skyBox}>
        {SKY.base}
      </pre>
      <pre className={`${skyLayer} sky-twinkle`} style={skyBox}>
        {SKY.twinkleA}
      </pre>
      <pre className={`${skyLayer} sky-twinkle [animation-delay:-3s]`} style={skyBox}>
        {SKY.twinkleB}
      </pre>
      <SkyLight text={SKY.base} />
    </div>
  );
}
