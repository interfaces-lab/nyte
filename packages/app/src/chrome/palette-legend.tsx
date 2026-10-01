import { props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import { paletteLegendStyles as styles } from "./palette-legend.stylex.ts";

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5] as const;
const DITHER_CELLS = 9;
const DITHER_PIXEL = 2;

function createDitherPaths() {
  const lit = [];
  const unlit = [];
  const radius = DITHER_CELLS / 2;

  for (let y = 0; y < DITHER_CELLS; y += 1) {
    for (let x = 0; x < DITHER_CELLS; x += 1) {
      const nx = (x + 0.5 - radius) / radius;
      const ny = (y + 0.5 - radius) / radius;
      const depth = 1 - nx * nx - ny * ny;

      if (depth <= 0) continue;
      const square = `M${String(x * DITHER_PIXEL)} ${String(y * DITHER_PIXEL)}h${String(
        DITHER_PIXEL - 1,
      )}v${String(DITHER_PIXEL - 1)}h-${String(DITHER_PIXEL - 1)}z`;
      const threshold = BAYER4[(y % 4) * 4 + (x % 4)];

      if (threshold === undefined) continue;
      const shade = -0.62 * nx - 0.5 * ny + 0.6 * Math.sqrt(depth);

      if (shade * 16 > threshold + 0.5) lit.push(square);
      else unlit.push(square);
    }
  }

  return { lit: lit.join(""), unlit: unlit.join("") };
}

const DITHER_PATHS = createDitherPaths();

function Keycap({
  children,
  icon = false,
  label,
}: {
  readonly children: ReactNode;
  readonly icon?: boolean;
  readonly label?: string;
}): ReactElement {
  return (
    <kbd aria-label={label} {...props(styles.keycap, icon && styles.keycapIcon)}>
      {children}
    </kbd>
  );
}

function DitherMark(): ReactElement {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      shapeRendering="crispEdges"
    >
      <path d={DITHER_PATHS.unlit} fill="currentColor" opacity={0.1} />
      <path d={DITHER_PATHS.lit} fill="currentColor" />
    </svg>
  );
}

export function PaletteLegend(): ReactElement {
  return (
    <footer aria-label="Keyboard shortcuts" {...props(styles.footer)}>
      <div {...props(styles.legend)}>
        <span {...props(styles.item)}>
          <span {...props(styles.keys)}>
            <Keycap icon label="Up arrow">
              <Icon name="arrow-up" size={12} />
            </Keycap>
            <Keycap icon label="Down arrow">
              <Icon name="arrow-down" size={12} />
            </Keycap>
          </span>
          Navigate
        </span>
        <span {...props(styles.item)}>
          <Keycap icon label="Enter">
            <Icon name="return" size={12} />
          </Keycap>
          Select
        </span>
        <span {...props(styles.item)}>
          <Keycap>esc</Keycap>
          Close
        </span>
      </div>
      <span {...props(styles.mark)}>
        <DitherMark />
      </span>
    </footer>
  );
}
