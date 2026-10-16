import { BarItem, ResponsiveBar } from "@nivo/bar";
import type { BarItemProps, BarTooltipProps } from "@nivo/bar";
import type { AxisTickProps } from "@nivo/axes";
import { Line } from "@nivo/line";
import { create, props } from "@stylexjs/stylex";
import { createContext, useContext, useMemo } from "react";
import type { CSSProperties, ReactElement } from "react";

import { radius, space } from "./styles/schema.stylex.ts";
import { mergeStyleProps } from "./style.ts";
import type { Restyle } from "./styles/contracts.ts";
import { surfaceTheme, type Tint } from "./surface-theme.ts";
import { text } from "./styles/text.stylex.ts";
import { role, shadow, type } from "./styles/vars.stylex.ts";

const styles = create({
  root: { minWidth: 0 },
  tip: {
    display: "flex",
    flexDirection: "column",
    gap: space.s0_5,
    paddingBlock: space.s1_5,
    paddingInline: space.s2,
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  tipTitle: { color: role.contentSecondary },
  tipRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: space.s4 },
  tipKey: { display: "flex", alignItems: "center", gap: space.s1_5 },
  tipTotal: { fontWeight: type.weightMedium },
  swatch: {
    flexShrink: 0,
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: role.chartSeries,
  },
  spark: { display: "block", flexShrink: 0, color: role.contentSecondary },
  sparkTinted: { color: role.chartSeries },
});

const BAR_THEME = {
  text: {
    fontFamily: type.fontSans,
    fontSize: 11,
    fill: role.contentTertiary,
    fontVariantNumeric: "tabular-nums",
  },
} as const;

const AXIS_HEIGHT = 20;

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
  /** Height of the bars, without the labels under them. @default 88 */
  readonly height?: number;
  /** Bucket labels under the bars, spread from the first bucket to the last. @default 5 */
  readonly ticks?: number;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly xstyle?: Restyle<"BarChart">;
}

function tickIndexes(count: number, ticks: number): readonly number[] {
  if (count <= ticks) return Array.from({ length: count }, (_slot, index) => index);

  return Array.from({ length: ticks }, (_slot, index) =>
    Math.round((index * (count - 1)) / (ticks - 1)),
  );
}

const seriesKey = (index: number): string => `s${String(index)}`;

interface BarChartContextValue {
  readonly series: readonly ChartSeries[];
  readonly buckets: readonly ChartBucket[];
  readonly format: (value: number) => string;
}

const BarChartContext = createContext<BarChartContextValue>({
  series: [],
  buckets: [],
  format: String,
});

type Datum = Record<string, string | number>;

/** One bar inside its series' tint scope. `fill` on the datum wins over nivo's resolved colour, so the scope applies. */
function Segment(item: BarItemProps<Datum>): ReactElement {
  const { series } = useContext(BarChartContext);
  const layer = series[Number(String(item.bar.data.id).slice(1))];

  return (
    <g {...props(layer !== undefined && surfaceTheme[layer.tint])}>
      <BarItem
        {...item}
        bar={{ ...item.bar, data: { ...item.bar.data, fill: role.chartSeries } }}
      />
    </g>
  );
}

function Readout({ indexValue }: BarTooltipProps<Datum>): ReactElement | null {
  const { series, buckets, format } = useContext(BarChartContext);
  const bucket = buckets[Number(indexValue)];

  if (bucket === undefined) return null;

  return (
    <div {...props(text.xs, styles.tip)}>
      <span {...props(styles.tipTitle)}>{bucket.label}</span>
      {series.map((layer, layerIndex) => {
        const value = bucket.values[layerIndex] ?? 0;

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
          <span>{format(bucket.values.reduce((sum, value) => sum + value, 0))}</span>
        </span>
      )}
    </div>
  );
}

function Tick({ value, x, y, textY }: AxisTickProps<string | number>): ReactElement {
  const { buckets } = useContext(BarChartContext);
  const index = Number(value);
  const anchor = index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle";

  return (
    <g transform={`translate(${String(x)},${String(y)})`}>
      <text
        y={textY}
        dominantBaseline="text-before-edge"
        textAnchor={anchor}
        style={BAR_THEME.text}
      >
        {buckets[index]?.label}
      </text>
    </g>
  );
}

/**
 * Bars stacked by series. Pointing at a segment opens a readout of its whole
 * bucket, so the stack reads without a legend.
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
  const keys = series.map((_layer, index) => seriesKey(index));

  const data = buckets.map((bucket, index) =>
    Object.fromEntries([
      ["bucket", String(index)],
      ...series.map((_layer, layerIndex) => [
        seriesKey(layerIndex),
        bucket.values[layerIndex] ?? 0,
      ]),
    ]),
  );

  const context = useMemo(() => ({ series, buckets, format }), [series, buckets, format]);

  return (
    <div
      {...mergeStyleProps(props(styles.root, xstyle), className, {
        height: height + AXIS_HEIGHT,
        ...style,
      })}
    >
      <BarChartContext value={context}>
        <ResponsiveBar
          data={data}
          keys={keys}
          indexBy="bucket"
          groupMode="stacked"
          margin={{ top: 0, right: 0, bottom: AXIS_HEIGHT, left: 0 }}
          padding={0.27}
          valueScale={{ type: "linear", nice: false }}
          barComponent={Segment}
          enableLabel={false}
          enableGridY={false}
          axisLeft={null}
          axisBottom={{
            tickSize: 0,
            tickPadding: 6,
            tickValues: tickIndexes(buckets.length, ticks).map(String),
            renderTick: Tick,
          }}
          theme={BAR_THEME}
          tooltip={Readout}
          animate={false}
          role="img"
          ariaLabel={label}
        />
      </BarChartContext>
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
  readonly xstyle?: Restyle<"Sparkline">;
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
  return (
    <span
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      {...mergeStyleProps(
        props(
          tint !== undefined && surfaceTheme[tint],
          styles.spark,
          tint !== undefined && styles.sparkTinted,
          xstyle,
        ),
        className,
        { width, height, ...style },
      )}
    >
      <Line
        data={[{ id: "trend", data: values.map((value, index) => ({ x: index, y: value })) }]}
        width={width}
        height={height}
        margin={{ top: 1, right: 1, bottom: 1, left: 1 }}
        xScale={{ type: "linear", min: 0, max: Math.max(values.length - 1, 1) }}
        yScale={{ type: "linear", min: 0, max: Math.max(...values, Number.EPSILON) }}
        colors={() => "currentColor"}
        lineWidth={1.25}
        layers={["lines"]}
        enablePoints={false}
        enableGridX={false}
        enableGridY={false}
        axisLeft={null}
        axisBottom={null}
        isInteractive={false}
        animate={false}
      />
    </span>
  );
}
