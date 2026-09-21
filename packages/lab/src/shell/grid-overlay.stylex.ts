import { create } from "@stylexjs/stylex";

const horizontal = "repeating-linear-gradient(to right, currentColor 0 3px, transparent 3px 6px)";
const vertical = "repeating-linear-gradient(to bottom, currentColor 0 3px, transparent 3px 6px)";
const solid = "linear-gradient(currentColor, currentColor)";

export const gridOverlay = create({
  root: {
    position: "fixed",
    zIndex: 999,
    inset: 0,
    overflow: "hidden",
    pointerEvents: "none",
    color: "rgb(64 155 255 / var(--lab-guide-opacity, 0.45))",
  },
  base: { zIndex: 50 },
  hairline: (width: number) => ({ "--lab-guide-width": `${width}px` }),
  column: (left: number, top: number, height: number) => ({
    position: "absolute",
    left,
    top,
    height,
    width: "var(--lab-guide-width)",
    backgroundImage: vertical,
  }),
  box: (left: number, top: number, width: number, height: number) => ({
    position: "absolute",
    left,
    top,
    width,
    height,
    backgroundImage: `${horizontal}, ${horizontal}`,
    backgroundSize: "100% var(--lab-guide-width)",
    backgroundPosition: "top left, bottom left",
    backgroundRepeat: "no-repeat",
  }),
  text: { backgroundImage: `${solid}, ${solid}`, opacity: 0.35 },
  surface: {
    backgroundImage: `${horizontal}, ${horizontal}, ${vertical}, ${vertical}`,
    backgroundSize:
      "100% var(--lab-guide-width), 100% var(--lab-guide-width), var(--lab-guide-width) 100%, var(--lab-guide-width) 100%",
    backgroundPosition: "top left, bottom left, top left, top right",
  },
});
