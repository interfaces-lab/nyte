/**
 * The strip across the top of a settings page. One field, drawn as dashes on
 * an 8px lattice and painted in hue bands, is read by a few crisp marks: a
 * frame with a chip at its corner, a label, a ruler. The board is 1200 × 200
 * and crops at the sides, so keep what matters inside x 350 to 850.
 */
import { create, keyframes, props } from "@stylexjs/stylex";
import { createContext, use, useId, useMemo, type ReactElement, type ReactNode } from "react";
import { Icon, type IconName } from "@nyte-ai/ui/icon";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { Point } from "./hub-art";

export const BOARD = { w: 1200, h: 200, cx: 600, cy: 100 } as const;

export const CELL = 8;

const GRID = 40;

/** Degrees between neighbouring bands on every page but Appearance, which walks the whole wheel. */
export const SPREAD = 10;

/** How a strip paints its fields: bands of `width` columns, `step` degrees apart. */
export interface Prism {
  /** The hue of the band that starts at column `anchor`, and of the strip's marks. */
  readonly hue: number;
  readonly step: number;
  readonly width: number;
  readonly anchor: number;
}

/** Five-column bands around `hue`, one of them starting just left of the board's centre. */
export function spectrum(hue: number, step = SPREAD): Prism {
  return { hue, step, width: 5, anchor: 73 };
}

const PrismContext = createContext<Prism>(spectrum(250));

export function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;

    return state / 4294967296;
  };
}

export function noise(column: number, row: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7) * 43758.5453;

  return value - Math.floor(value);
}

/** 0 at or below `from`, 1 at or above `to`, eased between. */
export function smooth(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));

  return t * t * (3 - 2 * t);
}

export type Strength = (x: number, y: number, column: number, row: number) => number;

interface Run {
  readonly column: number;
  readonly level: number;
  readonly from: number;
  readonly to: number;
}

interface Cell {
  readonly column: number;
  readonly row: number;
}

export interface Plot {
  readonly runs: readonly Run[];
  readonly sparks: readonly Cell[];
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const COLUMNS = Array.from({ length: BOARD.w / CELL }, (_, column) => column);

const ROWS = Array.from({ length: BOARD.h / CELL }, (_, row) => row);

/**
 * Samples `strength` at every cell's centre and dithers it to five levels.
 * `sparkle` is the chance that a full-strength cell in a column carries a spark.
 */
export function plot(strength: Strength, sparkle: (column: number) => number = () => 0.1): Plot {
  const levels = COLUMNS.map((column) =>
    ROWS.map((row) => {
      const value = strength(column * CELL + CELL / 2, row * CELL + CELL / 2, column, row);

      if (value <= 0) return 0;
      const threshold = ((BAYER[(row % 4) * 4 + (column % 4)] ?? 0) + 0.5) / 16 - 0.5;

      return Math.max(0, Math.min(4, Math.round(value * 4 + threshold * 0.9)));
    }),
  );

  return {
    runs: levels.flatMap((cells, column) => {
      const starts = cells.flatMap((level, row) =>
        row === 0 || cells[row - 1] !== level ? [row] : [],
      );

      return starts.flatMap((from, index) => {
        const level = cells[from] ?? 0;

        return level === 0
          ? []
          : [{ column, level, from, to: (starts[index + 1] ?? cells.length) - 1 }];
      });
    }),
    sparks: levels.flatMap((cells, column) =>
      cells.flatMap((level, row) =>
        level === 4 && noise(column + 17, row + 31) < sparkle(column) ? [{ column, row }] : [],
      ),
    ),
  };
}

interface Band {
  readonly index: number;
  readonly inks: readonly string[];
  readonly sparks: string;
}

const LEVELS = [4, 3, 2, 1] as const;

function splitBands(field: Plot, width: number, anchor: number): readonly Band[] {
  const band = (column: number): number => Math.floor((column - anchor) / width);
  const sparks = Map.groupBy(field.sparks, (cell) => band(cell.column));

  return [...Map.groupBy(field.runs, (run) => band(run.column))].map(([index, runs]) => ({
    index,
    inks: LEVELS.map((level) =>
      runs
        .flatMap((run) =>
          run.level === level
            ? [`M${run.column * CELL + CELL / 2} ${run.from * CELL + 1}V${run.to * CELL + 7}`]
            : [],
        )
        .join(""),
    ),
    sparks: (sparks.get(index) ?? [])
      .map((cell) => `M${cell.column * CELL + CELL / 2} ${cell.row * CELL + 3.4}v1.2`)
      .join(""),
  }));
}

/** A ref that points an element's custom theme at `degrees`, and at `chroma` when given. */
function hued(degrees: number, chroma?: number): (node: ElementCSSInlineStyle | null) => void {
  return (node) => {
    node?.style.setProperty("--nyte-custom-hue", String(degrees));

    if (chroma !== undefined) node?.style.setProperty("--nyte-custom-chroma-scale", String(chroma));
  };
}

/**
 * A plot painted band by band, each band in its own hue from the strip's prism,
 * or from `prism` when given; `chroma` scales each band's tint by its index.
 */
export function Field({
  plot: field,
  cells = "dash",
  twinkle = false,
  prism: own,
  chroma,
}: {
  readonly plot: Plot;
  readonly cells?: "dash" | "square";
  readonly twinkle?: boolean;
  readonly prism?: Prism;
  readonly chroma?: (band: number) => number;
}): ReactElement {
  const strip = use(PrismContext);
  const prism = own ?? strip;

  const bands = useMemo(
    () => splitBands(field, prism.width, prism.anchor),
    [field, prism.width, prism.anchor],
  );

  return (
    <g>
      {bands.map((band) => (
        <g
          key={band.index}
          ref={hued(prism.hue + band.index * prism.step, chroma?.(band.index))}
          {...props(surfaceTheme.custom)}
        >
          {band.inks.map(
            (d, index) =>
              d !== "" && (
                <path
                  key={index}
                  d={d}
                  {...props(fieldInk.run, FIELD_INKS[index], cells === "square" && fieldInk.square)}
                />
              ),
          )}
          {band.sparks !== "" && (
            <path d={band.sparks} {...props(fieldInk.spark, twinkle && fieldInk.twinkle)} />
          )}
        </g>
      ))}
    </g>
  );
}

/** How many plots a `Frames` loop steps through: `flip` shows each for an eighth of the loop. */
export const FRAME_COUNT = 8;

/**
 * Plays `FRAME_COUNT` plots in order, one at a time, looping every `seconds`:
 * a field can't move, so motion is a field redrawn. Reduced motion holds the first.
 */
export function Frames({
  plots,
  seconds,
}: {
  readonly plots: readonly Plot[];
  readonly seconds: number;
}): ReactElement {
  return (
    <g>
      {plots.map((field, index) => (
        <g
          key={index}
          {...props(
            reel.frame,
            index > 0 && reel.later,
            reel.timing(`${String(seconds)}s`, `${((-index * seconds) / FRAME_COUNT).toFixed(3)}s`),
          )}
        >
          <Field plot={field} />
        </g>
      ))}
    </g>
  );
}

export interface Area {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export function Frame({
  x,
  y,
  w,
  h,
  tone = "mark",
}: Area & { readonly tone?: "mark" | "faint" }): ReactElement {
  const corners = [
    { x, y },
    { x: x + w, y },
    { x, y: y + h },
    { x: x + w, y: y + h },
  ];

  return (
    <g>
      <rect x={x} y={y} width={w} height={h} {...props(frame.edge, frame[tone])} />
      {corners.map((corner) => (
        <circle
          key={`${corner.x},${corner.y}`}
          cx={corner.x}
          cy={corner.y}
          r={2.2}
          {...props(frame[`${tone}Corner`])}
        />
      ))}
    </g>
  );
}

/** A dashed reading line with a dot at each end: a threshold, an average, a playhead. */
export function Level({
  from,
  to,
  tone = "mark",
}: {
  readonly from: Point;
  readonly to: Point;
  readonly tone?: "mark" | "faint";
}): ReactElement {
  return (
    <g>
      <path d={`M${from.x} ${from.y}L${to.x} ${to.y}`} {...props(level.line, frame[tone])} />
      {[from, to].map((end) => (
        <circle
          key={`${end.x},${end.y}`}
          cx={end.x}
          cy={end.y}
          r={2.2}
          {...props(frame[`${tone}Corner`])}
        />
      ))}
    </g>
  );
}

type Align = "start" | "middle" | "end";

const SLOT = { w: 360, h: 24 } as const;

function Slot({
  x,
  y,
  align,
  children,
}: {
  readonly x: number;
  readonly y: number;
  readonly align: Align;
  readonly children: ReactNode;
}): ReactElement {
  const left = align === "start" ? x : align === "middle" ? x - SLOT.w / 2 : x - SLOT.w;

  return (
    <foreignObject x={left} y={y - SLOT.h / 2} width={SLOT.w} height={SLOT.h}>
      <div {...props(slot.row, slot[align])}>{children}</div>
    </foreignObject>
  );
}

export function Chip({
  x,
  y,
  label,
  icon,
  tone = "mark",
  align = "start",
}: {
  readonly x: number;
  readonly y: number;
  readonly label: string;
  readonly icon?: IconName;
  readonly tone?: "mark" | "lit" | "idle";
  readonly align?: Align;
}): ReactElement {
  return (
    <Slot x={x} y={y} align={align}>
      <span {...props(text.base, chip.plate, chip[tone])}>
        {icon !== undefined && <Icon name={icon} size={12} />}
        {label}
      </span>
    </Slot>
  );
}

export function Label({
  x,
  y,
  children,
  icon,
  tone = "tertiary",
  align = "start",
  mono = false,
  size = "xs",
}: {
  readonly x: number;
  readonly y: number;
  readonly children: ReactNode;
  readonly icon?: IconName;
  readonly size?: "xs" | "sm";
  readonly tone?: "primary" | "secondary" | "tertiary";
  readonly align?: Align;
  readonly mono?: boolean;
}): ReactElement {
  return (
    <Slot x={x} y={y} align={align}>
      <span
        {...props(
          text.base,
          size === "sm" && text.sm,
          icon !== undefined && text.line,
          text[tone],
          mono && text.mono,
        )}
      >
        {icon !== undefined && <Icon name={icon} size={12} />}
        {children}
      </span>
    </Slot>
  );
}

export function Glyph({
  name,
  x,
  y,
  size,
  tone = "tertiary",
}: {
  readonly name: IconName;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly tone?: "tertiary" | "primary";
}): ReactElement {
  return (
    <foreignObject x={x - size / 2} y={y - size / 2} width={size} height={size}>
      <div {...props(glyph.box, glyph[tone])}>
        <Icon name={name} size={size} />
      </div>
    </foreignObject>
  );
}

const LATTICE = {
  scan: COLUMNS.map((column) => `M${column * CELL + CELL / 2} 0V${BOARD.h}`).join(""),
  grid: [
    ...Array.from(
      { length: BOARD.w / GRID - 1 },
      (_, index) => `M${(index + 1) * GRID} 0V${BOARD.h}`,
    ),
    ...Array.from(
      { length: BOARD.h / GRID - 1 },
      (_, index) => `M0 ${(index + 1) * GRID}H${BOARD.w}`,
    ),
  ].join(""),
  crossings: Array.from({ length: BOARD.w / GRID - 1 }, (_, column) =>
    Array.from({ length: BOARD.h / GRID - 1 }, (_, row) => {
      const x = (column + 1) * GRID;
      const y = (row + 1) * GRID;

      return `M${x - 3} ${y}H${x + 3}M${x} ${y - 3}V${y + 3}`;
    }).join(""),
  ).join(""),
} as const;

/**
 * The board: the lattice and `backdrop` fade toward the edges and part around
 * `clear`; `children` draw on top. Every field inside paints with `prism`, and
 * the marks take its hue; `chroma` scales how strongly any of it is tinted.
 */
export function Strip({
  prism,
  chroma = 1,
  dim = false,
  backdrop,
  clear = [],
  children,
}: {
  readonly prism: Prism;
  readonly chroma?: number;
  readonly dim?: boolean;
  readonly backdrop?: ReactNode;
  readonly clear?: readonly Area[];
  readonly children?: ReactNode;
}): ReactElement {
  const holes = `${useId()}-holes`;

  return (
    <figure
      ref={(node) => {
        if (node === null) return;
        node.style.setProperty("--nyte-custom-hue", String(prism.hue));
        node.style.setProperty("--nyte-custom-chroma-scale", String(chroma));
      }}
      {...props(surfaceTheme.custom, styles.strip)}
    >
      <PrismContext value={prism}>
        <svg
          viewBox={`0 0 ${BOARD.w} ${BOARD.h}`}
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          {...props(styles.board, styles.backdrop)}
        >
          {clear.length > 0 && (
            <defs>
              <mask
                id={holes}
                maskUnits="userSpaceOnUse"
                x={0}
                y={0}
                width={BOARD.w}
                height={BOARD.h}
              >
                <rect width={BOARD.w} height={BOARD.h} fill="white" />
                {clear.map((area) => (
                  <rect
                    key={`${area.x},${area.y}`}
                    x={area.x}
                    y={area.y}
                    width={area.w}
                    height={area.h}
                    fill="black"
                  />
                ))}
              </mask>
            </defs>
          )}
          <g mask={clear.length > 0 ? `url(#${holes})` : undefined}>
            <path d={LATTICE.scan} {...props(lattice.scan)} />
            <path d={LATTICE.grid} {...props(lattice.grid)} />
            <path d={LATTICE.crossings} {...props(lattice.crossing)} />
            {backdrop}
          </g>
        </svg>
        <svg
          viewBox={`0 0 ${BOARD.w} ${BOARD.h}`}
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          {...props(styles.board)}
        >
          <g {...props(dim && styles.breathing)}>{children}</g>
        </svg>
      </PrismContext>
    </figure>
  );
}

const breathe = keyframes({ "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.4 } });

const glint = keyframes({ "0%, 100%": { opacity: 0.85 }, "50%": { opacity: 0.15 } });

const flip = keyframes({
  "0%": { opacity: 1 },
  "12.5%": { opacity: 0 },
  "100%": { opacity: 0 },
});

const reduced = "@media (prefers-reduced-motion: reduce)";

const EDGE_FADE = [
  "linear-gradient(90deg, transparent, black 84px, black calc(100% - 84px), transparent)",
  "linear-gradient(transparent, black 24px, black calc(100% - 24px), transparent)",
].join(", ");

const styles = create({
  strip: {
    position: "relative",
    height: 200,
    margin: 0,
    overflow: "clip",
    isolation: "isolate",
  },
  board: {
    position: "absolute",
    inset: 0,
    display: "block",
    width: "100%",
    height: "100%",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  backdrop: { maskImage: EDGE_FADE, maskComposite: "intersect" },
  breathing: {
    animationName: { default: breathe, [reduced]: "none" },
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: motion.easeInOutStrong,
  },
});

const reel = create({
  frame: {
    animationName: { default: flip, [reduced]: "none" },
    animationIterationCount: "infinite",
    animationTimingFunction: "steps(1, end)",
  },
  later: { opacity: 0 },
  timing: (duration: string, delay: string) => ({
    animationDuration: duration,
    animationDelay: delay,
  }),
});

const lattice = create({
  scan: { fill: "none", stroke: role.bgMuted, strokeWidth: 0.8 },
  grid: { fill: "none", stroke: role.borderSecondary, strokeWidth: 1 },
  crossing: {
    fill: "none",
    stroke: role.contentDisabled,
    strokeWidth: 1,
    strokeLinecap: "butt",
  },
});

const fieldInk = create({
  run: { fill: "none", strokeDasharray: "6 2", strokeLinecap: "butt" },
  first: { stroke: `oklch(from ${role.contentPrimary} l calc(c * 1.8) h)`, strokeWidth: 4 },
  second: { stroke: role.contentSecondary, strokeWidth: 3 },
  third: { stroke: role.chartSeries, strokeWidth: 2 },
  fourth: { stroke: role.borderStrong, strokeWidth: 1.2, opacity: 0.55 },
  square: { strokeWidth: 6 },
  spark: {
    fill: "none",
    stroke: role.contentOnInteractiveStrong,
    strokeWidth: 1.2,
    strokeLinecap: "round",
    opacity: 0.85,
  },
  twinkle: {
    animationName: { default: glint, [reduced]: "none" },
    animationDuration: "2.8s",
    animationIterationCount: "infinite",
    animationTimingFunction: motion.easeInOutStrong,
  },
});

const FIELD_INKS = [fieldInk.first, fieldInk.second, fieldInk.third, fieldInk.fourth];

const slot = create({
  row: { display: "flex", alignItems: "center", width: "100%", height: "100%" },
  start: { justifyContent: "flex-start" },
  middle: { justifyContent: "center" },
  end: { justifyContent: "flex-end" },
});

const text = create({
  base: {
    fontFamily: type.fontSans,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontWeight: type.weightRegular,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  sm: { fontSize: type.fontSm, lineHeight: type.leadingSm, fontWeight: type.weightMedium },
  line: { display: "inline-flex", alignItems: "center", gap: 5 },
  mono: { fontFamily: type.fontMono },
  primary: { color: role.contentPrimary },
  secondary: { color: role.contentSecondary },
  tertiary: { color: role.contentTertiary },
});

const chip = create({
  plate: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    paddingBlock: 2,
    paddingInline: 6,
    borderRadius: 3,
    fontWeight: type.weightMedium,
  },
  mark: { backgroundColor: role.contentSecondary, color: role.bgBase },
  lit: {
    backgroundColor: role.bgBase,
    boxShadow: `inset 0 0 0 1px ${role.contentSecondary}`,
    color: role.contentPrimary,
  },
  idle: {
    backgroundColor: role.bgBase,
    boxShadow: `inset 0 0 0 1px ${role.borderPrimary}`,
    color: role.contentTertiary,
  },
});

const glyph = create({
  box: {
    display: "flex",
    width: "100%",
    height: "100%",
    transitionProperty: "color",
    transitionDuration: motion.durationNormal,
  },
  tertiary: { color: role.contentTertiary },
  primary: { color: role.contentPrimary },
});

const frame = create({
  edge: { fill: "none", strokeWidth: 1.2 },
  mark: { stroke: role.contentSecondary },
  faint: { stroke: role.borderPrimary },
  markCorner: { fill: role.contentSecondary },
  faintCorner: { fill: role.borderPrimary },
});

const level = create({
  line: { fill: "none", strokeWidth: 1.2, strokeDasharray: "6 5" },
});

export const ink = create({
  primaryFill: { fill: role.contentPrimary },
  markFill: { fill: role.contentSecondary },
  strongFill: { fill: role.borderStrong },
  faint: { fill: "none", stroke: role.borderPrimary, strokeWidth: 1 },
  strong: { fill: "none", stroke: role.borderStrong, strokeWidth: 1 },
  mark: { fill: "none", stroke: role.contentSecondary, strokeWidth: 1.2 },
  fade: { transitionProperty: "opacity", transitionDuration: motion.durationNormal },
});
