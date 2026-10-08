import { AsciiArt } from "./ascii-art";

const COLS = 32;
const ROWS = 20;
const RAMP = ".:-=+*#%@";
const MOON = Array.from({ length: ROWS }, (_, row) =>
  Array.from({ length: COLS }, (_, col) => {
    const x = (col + 0.5 - COLS / 2) / (COLS / 2);
    const y = (row + 0.5 - ROWS / 2) / (ROWS / 2);
    const depth = 1 - x * x - y * y;
    if (depth <= 0) return " ";
    const light = Math.max(0, -0.6 * x - 0.45 * y + 0.55 * Math.sqrt(depth));
    return RAMP.charAt(Math.min(RAMP.length - 1, Math.floor(light * RAMP.length)));
  }).join(""),
);

export function AsciiMoon({ className }: { className?: string }) {
  return <AsciiArt rows={MOON} className={className} />;
}
