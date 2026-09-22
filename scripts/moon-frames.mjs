// Generates the ASCII moon frames used by the desktop startup shell.
// Cells are 23x12: at 0.6ch advance width and 1.15 line-height the disc is square.

const COLS = 23;

const ROWS = 12;

const FRAMES = 24;

// Dark to bright. The unlit limb keeps faint glyphs so the full disc stays readable.
const LIT_RAMP = "+*#%@";

const DARK_RAMP = " .:-";

// Fixed maria, in unit-disc coordinates: [x, y, radius, depth].
const MARIA = [
  [-0.3, -0.35, 0.34, 0.35],
  [0.12, -0.5, 0.22, 0.28],
  [0.3, 0.12, 0.3, 0.3],
  [-0.45, 0.35, 0.22, 0.22],
  [0.05, 0.3, 0.16, 0.18],
];

const mariaShade = (x, y) => {
  let shade = 0;

  for (const [cx, cy, r, depth] of MARIA) {
    const d = Math.hypot(x - cx, y - cy) / r;

    if (d < 1) shade = Math.max(shade, depth * (1 - d * d));
  }

  return shade;
};

const pick = (ramp, t) =>
  ramp[Math.min(ramp.length - 1, Math.max(0, Math.round(t * (ramp.length - 1))))];

const frame = (phase) => {
  // Sun direction in the disc plane; phase 0 is new, 0.5 is full.
  const angle = phase * Math.PI * 2;
  const sun = [Math.sin(angle), 0, -Math.cos(angle)];
  const rows = [];

  for (let row = 0; row < ROWS; row++) {
    let line = "";

    for (let col = 0; col < COLS; col++) {
      const x = ((col + 0.5) / COLS) * 2 - 1;
      const y = ((row + 0.5) / ROWS) * 2 - 1;
      const r2 = x * x + y * y;

      if (r2 > 1) {
        line += " ";
        continue;
      }

      const z = Math.sqrt(1 - r2);
      const light = x * sun[0] + y * sun[1] + z * sun[2];
      const shade = mariaShade(x, y);

      if (light > 0) {
        // Soften the terminator and the limb so the sphere reads as a sphere.
        const t = Math.min(1, Math.pow(light, 0.55)) * (1 - shade) * (0.55 + 0.45 * z);
        line += pick(LIT_RAMP, t);
      } else {
        const t = (0.6 + 0.4 * z) * (1 - shade) * (1 + Math.max(-0.35, light));
        line += pick(DARK_RAMP, Math.min(1, t));
      }
    }

    rows.push(line.replace(/\s+$/, ""));
  }

  return rows;
};

const frames = Array.from({ length: FRAMES }, (_, i) => frame(i / FRAMES));

if (process.argv.includes("--html")) {
  console.log(
    frames.map((rows, i) => `<pre style="--frame: ${i}">${rows.join("\n")}</pre>`).join("\n"),
  );
} else {
  console.log(frames.map((rows, i) => `phase ${i}\n${rows.join("\n")}`).join("\n\n"));
}
