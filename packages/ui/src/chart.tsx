/**
 * Small charts for figures that sit beside their own numbers: a stacked bar per
 * bucket and a sparkline for a table row. Neither draws axes or gridlines. The
 * numbers live in the surrounding copy, so a chart only has to carry shape.
 *
 * Bars scale on one axis only (`preserveAspectRatio="none"`), so a chart takes
 * its container's width without measuring it. Nothing in them is stroked, so
 * the stretch never thickens an edge.
 */
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { CSSProperties, KeyboardEvent, PointerEvent, ReactElement } from "react";

import { focus } from "./a11y.stylex.ts";
import { radius } from "./schema.stylex.ts";
import { mergeStyleProps, type XStyle } from "./style.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { motion, role, shadow, type } from "./vars.stylex.ts";

/** Bucket width in viewBox units; the gap is what is left of it after the bar. */
const SLOT = 15;

const BAR = 11;

const styles = create({
  root: { position: "relative", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 },
  plot: { borderRadius: radius.indicator },
  svg: { display: "block", width: "100%", overflow: "visible" },
  bucket: {
    transitionProperty: "opacity",
    transitionDuration: motion.durationFast,
    transitionTimingFunction: motion.easeOut,
    "@media (prefers-reduced-motion: reduce)": { transitionProperty: "none" },
  },
  recede: { opacity: 0.4 },
  segment: { fill: role.bgInteractiveStrong, fillOpacity: 0.8 },
  axis: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    color: role.contentTertiary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  tip: {
    position: "absolute",
    insetBlockStart: 0,
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 2,
    paddingBlock: 6,
    paddingInline: 8,
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    color: role.contentPrimary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    pointerEvents: "none",
  },
  tipTitle: { color: role.contentSecondary },
  tipRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 },
  tipKey: { display: "flex", alignItems: "center", gap: 6 },
  tipTotal: { fontWeight: 500 },
  swatch: {
    flexShrink: 0,
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: role.bgInteractiveStrong,
  },
  spark: { display: "block", flexShrink: 0, overflow: "visible" },
  sparkLine: {
    fill: "none",
    stroke: role.contentSecondary,
    strokeWidth: 1.25,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
  sparkTinted: { stroke: role.bgInteractiveStrong },
});

/** One stacked layer: its name in the readout and the hue it paints in. */
export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  readonly tint: Tint;
}

/** One bar: what to call it and a value per series, in series order. */
export interface ChartBucket {
  readonly key: string;
  readonly label: string;
  readonly values: readonly number[];
}

export interface BarChartProps {
  /** The chart's accessible name. */
  readonly label: string;
  /** Painted bottom to top. */
  readonly series: readonly ChartSeries[];
  readonly buckets: readonly ChartBucket[];
  /** How a value reads in the readout. */
  readonly format: (value: number) => string;
  /** @default 88 */
  readonly height?: number;
  /** Bucket labels under the bars, spread from the first bucket to the last. @default 5 */
  readonly ticks?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: XStyle;
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0);

/** Evenly spaced bucket indexes, always including both ends. */
function tickIndexes(count: number, ticks: number): readonly number[] {
  if (count === 0) return [];

  if (count <= ticks) return Array.from({ length: count }, (_slot, index) => index);

  return Array.from({ length: ticks }, (_slot, index) =>
    Math.round((index * (count - 1)) / (ticks - 1)),
  );
}

/**
 * Bars stacked by series. Pointing at a bucket, or moving through them with the
 * arrow keys, opens a readout of its values.
 */
export function BarChart({
  label,
  series,
  buckets,
  format,
  height = 88,
  ticks = 5,
  className,
  style,
  xstyle,
}: BarChartProps): ReactElement {
  const [active, setActive] = useState<{ index: number; byKey: boolean } | null>(null);
  const count = buckets.length;
  const peak = Math.max(...buckets.map((bucket) => sum(bucket.values)), Number.EPSILON);
  const width = Math.max(count, 1) * SLOT;
  const focused = active === null ? undefined : buckets[active.index];
  const clamp = (index: number): number => Math.min(Math.max(index, 0), count - 1);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();

    if (box.width === 0 || count === 0) return;
    setActive({
      index: clamp(Math.floor(((event.clientX - box.left) / box.width) * count)),
      byKey: false,
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const at = active?.index;
    const next =
      event.key === "ArrowRight"
        ? clamp(at === undefined ? 0 : at + 1)
        : event.key === "ArrowLeft"
          ? clamp(at === undefined ? count - 1 : at - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? count - 1
              : undefined;

    if (next === undefined) {
      if (event.key === "Escape") setActive(null);

      return;
    }

    event.preventDefault();
    setActive({ index: next, byKey: true });
  };

  // The readout opens on the side of the bucket with more room.
  const tipSide =
    active === null
      ? undefined
      : active.index < count / 2
        ? { left: `${String(((active.index + 1) / count) * 100)}%`, marginLeft: 4 }
        : { right: `${String(((count - active.index) / count) * 100)}%`, marginRight: 4 };

  return (
    <div {...mergeStyleProps(props(styles.root, xstyle), className, style)}>
      <div
        role="group"
        aria-label={label}
        tabIndex={count === 0 ? undefined : 0}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setActive(null)}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
        {...props(styles.plot, focus.ring)}
      >
        <svg
          aria-hidden="true"
          viewBox={`0 0 ${String(width)} ${String(height)}`}
          preserveAspectRatio="none"
          height={height}
          {...props(styles.svg)}
        >
          {buckets.map((bucket, index) => {
            let floor = 0;

            return (
              <g
                key={bucket.key}
                {...props(styles.bucket, active !== null && active.index !== index && styles.recede)}
              >
                {series.map((layer, layerIndex) => {
                  const value = bucket.values[layerIndex] ?? 0;
                  const from = floor;
                  floor += value;

                  if (value <= 0) return null;
                  const top = height * (1 - (from + value) / peak);

                  return (
                    <rect
                      key={layer.key}
                      x={index * SLOT + (SLOT - BAR) / 2}
                      y={top}
                      width={BAR}
                      height={height * (1 - from / peak) - top}
                      {...props(surfaceTheme[layer.tint], styles.segment)}
                    />
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>
      <div aria-hidden="true" {...props(styles.axis)}>
        {tickIndexes(count, ticks).map((index) => (
          <span key={index}>{buckets[index]?.label}</span>
        ))}
      </div>
      {focused !== undefined && active !== null && (
        <div
          aria-live={active.byKey ? "polite" : undefined}
          aria-hidden={active.byKey ? undefined : true}
          {...props(styles.tip)}
          style={tipSide}
        >
          <span {...props(styles.tipTitle)}>{focused.label}</span>
          {series.map((layer, layerIndex) => {
            const value = focused.values[layerIndex] ?? 0;

            return value <= 0 ? null : (
              <span key={layer.key} {...props(styles.tipRow)}>
                <span {...props(styles.tipKey)}>
                  <span aria-hidden="true" {...props(surfaceTheme[layer.tint], styles.swatch)} />
                  {layer.label}
                </span>
                <span>{format(value)}</span>
              </span>
            );
          })}
          {series.length > 1 && (
            <span {...props(styles.tipRow, styles.tipTotal)}>
              <span>Total</span>
              <span>{format(sum(focused.values))}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export interface SparklineProps {
  readonly values: readonly number[];
  /** Strokes in this hue instead of the secondary content colour. */
  readonly tint?: Tint;
  /** Names the line for assistive technology; without one the line is decorative. */
  readonly label?: string;
  /** @default 72 */
  readonly width?: number;
  /** @default 20 */
  readonly height?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: XStyle;
}

/** A row's trend, scaled to its own peak so a small row still shows its shape. */
export function Sparkline({
  values,
  tint,
  label,
  width = 72,
  height = 20,
  className,
  style,
  xstyle,
}: SparklineProps): ReactElement {
  const peak = Math.max(...values, Number.EPSILON);
  const step = width / Math.max(values.length - 1, 1);
  // The stroke's half-width, so a peak or a zero is not clipped at the edge.
  const inset = 1;

  const points = values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : index * step;
      const y = inset + (height - 2 * inset) * (1 - value / peak);

      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      width={width}
      height={height}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      {...mergeStyleProps(props(styles.spark, xstyle), className, style)}
    >
      <polyline
        points={points}
        {...props(tint !== undefined && surfaceTheme[tint], styles.sparkLine, tint !== undefined && styles.sparkTinted)}
      />
    </svg>
  );
}
