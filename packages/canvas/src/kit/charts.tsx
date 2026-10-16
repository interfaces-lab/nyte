import { ResponsiveBar } from "@nivo/bar";
import type { BarDatum, BarTooltipProps } from "@nivo/bar";
import { ResponsiveLine } from "@nivo/line";
import type { LineSeries, SliceTooltipProps } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import type { PieTooltipProps } from "@nivo/pie";
import { create, props } from "@stylexjs/stylex";
import { createContext, useContext, useState } from "react";
import type { ReactElement } from "react";
import { platformScopes } from "@nyte-ai/ui/platform-colors";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import { role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { TINTS } from "@nyte-ai/plugin/canvas/protocol";
import { useColorScheme } from "./scheme.ts";

const HUES: readonly Tint[] = TINTS.slice(0, 8);

const MAX_BOTTOM_TICKS = 8;

/** Room between two tick labels on a horizontal axis. */
const TICK_GAP = 16;

const TICK_PADDING = 8;

/** A category axis never takes more of a horizontal bar chart than this. */
const LABEL_SHARE = 0.4;

const styles = create({
  chart: { display: "flex", flexDirection: "column", gap: space.s2, minWidth: 0 },
  plot: (height: number) => ({ height: `${String(height)}px`, minWidth: 0 }),
  empty: (height: number) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: `${String(height)}px`,
    borderRadius: radius.card,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
  }),
  legend: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: space.s3,
    rowGap: space.s1,
    color: role.contentSecondary,
  },
  key: { display: "inline-flex", alignItems: "center", gap: space.s1_5, minWidth: 0 },
  keyValue: { color: role.contentPrimary, fontVariantNumeric: "tabular-nums" },
  swatch: {
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: 2,
    backgroundColor: role.chartSeries,
  },
  readout: {
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
  readoutTitle: { color: role.contentSecondary },
  readoutRow: { display: "flex", justifyContent: "space-between", gap: space.s4 },
  readoutLabel: { display: "flex", alignItems: "center", gap: space.s1_5 },
  readoutTotal: {
    marginBlockStart: space.s0_5,
    paddingBlockStart: space.s0_5,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondary,
    fontWeight: type.weightMedium,
  },
});

type Format<Value> = (value: Value) => string;

type Keyed = { readonly id: string; readonly tint: Tint; readonly value?: string };

type ReadoutContextValue = {
  readonly format: Format<number>;
  readonly layers: readonly { readonly key: string; readonly label: string; readonly tint: Tint }[];
};

const ReadoutContext = createContext<ReadoutContextValue>({
  format: (value) => value.toLocaleString(),
  layers: [],
});

const findTint = (layers: ReadoutContextValue["layers"], key: string): Tint =>
  layers.find((layer) => layer.key === key)?.tint ?? "blue";

/**
 * Axis, grid and marker ink. Tick labels take secondary ink at the xs size in
 * the UI font with tabular figures, as the ui StackedBars do; grid lines stay
 * recessive.
 */
const theme = {
  text: {
    fontFamily: type.fontSans,
    fontSize: type.fontXs,
    fill: role.contentSecondary,
    fontVariantNumeric: "tabular-nums",
    outlineWidth: 0,
  },
  axis: { ticks: { line: { strokeWidth: 0 } }, domain: { line: { strokeWidth: 0 } } },
  grid: { line: { stroke: role.borderPrimary, strokeWidth: 1 } },
  crosshair: { line: { stroke: role.borderStrong, strokeWidth: 1, strokeOpacity: 1 } },
};

const MARGIN = { top: 10, right: 12, bottom: 28, left: 48 };

function usePaint(): (tint: Tint) => string {
  const scheme = useColorScheme();

  return (tint) =>
    (tint === "custom" ? platformScopes[scheme].blue : platformScopes[scheme][tint]).chartSeries;
}

const tintAt = (index: number): Tint => HUES[index % HUES.length] ?? "blue";

let measuring: CanvasRenderingContext2D | null | undefined;

/** The widest of `labels` as the axes set them: the UI font at the xs size. */
function labelWidth(labels: readonly string[]): number {
  measuring ??= document.createElement("canvas").getContext("2d");
  const style = getComputedStyle(document.documentElement);
  const base = Number.parseFloat(style.getPropertyValue("--nyte-font-size-base"));
  const size = ((Number.isFinite(base) ? base : 13) * 11) / 13;

  if (measuring === null) return Math.max(0, ...labels.map((label) => label.length * size * 0.6));
  measuring.font = `${String(size)}px ${style.getPropertyValue("--nyte-font-family-sans")}`;
  const context = measuring;

  return Math.max(0, ...labels.map((label) => context.measureText(label).width));
}

/** `label`, cut with an ellipsis until it fits `width`. */
function fitLabel(label: string, width: number): string {
  if (labelWidth([label]) <= width) return label;

  for (let length = label.length - 1; length > 1; length -= 1) {
    const cut = `${label.slice(0, length).trimEnd()}…`;

    if (labelWidth([cut]) <= width) return cut;
  }

  return "…";
}

/** How many tick labels `widest` wide fit across `width`, at least two and at most `most`. */
function tickRoom(width: number, widest: number, most: number): number {
  if (width <= 0) return most;

  return Math.max(2, Math.min(most, Math.floor(width / (widest + TICK_GAP))));
}

/** Every nth value from the first, n as small as lets the labels fit `width`. */
function fitTicks<Value>(values: readonly Value[], width: number, widest: number): Value[] {
  const step = Math.ceil(values.length / tickRoom(width, widest, MAX_BOTTOM_TICKS));

  return values.filter((_, index) => index % step === 0);
}

/** Round values from `low` to `high` at a 1, 2 or 5 step, no more than `most` of them. */
function valueTicks(low: number, high: number, most: number): number[] {
  if (high <= low) return [low];
  let step = 10 ** Math.floor(Math.log10((high - low) / most));

  for (const factor of [1, 2, 5, 10, 20, 50]) {
    const candidate = step * factor;

    if (Math.floor(high / candidate) - Math.ceil(low / candidate) + 1 <= most) {
      step = candidate;
      break;
    }
  }

  return Array.from(
    { length: Math.floor(high / step) - Math.ceil(low / step) + 1 },
    (_, index) => (Math.ceil(low / step) + index) * step,
  );
}

/** The room a value axis needs for its widest label, rounding the extremes up as a nice scale does. */
function valueAxisWidth(values: readonly number[], format: Format<number>): number {
  const extremes = [Math.min(0, ...values), Math.max(0, ...values)];

  const rounded = extremes.map((value) => {
    if (value === 0) return 0;
    const step = 10 ** Math.floor(Math.log10(Math.abs(value)));

    return Math.sign(value) * Math.ceil(Math.abs(value) / step) * step;
  });

  return Math.ceil(labelWidth([...extremes, ...rounded].map(format))) + TICK_PADDING;
}

function Legend({ entries }: { readonly entries: readonly Keyed[] }): ReactElement {
  return (
    <div {...props(text.xs, styles.legend)}>
      {entries.map((entry) => (
        <span key={entry.id} {...props(styles.key)}>
          <span aria-hidden="true" {...props(surfaceTheme[entry.tint], styles.swatch)} />
          {entry.id}
          {entry.value === undefined ? null : (
            <span {...props(styles.keyValue)}>{entry.value}</span>
          )}
        </span>
      ))}
    </div>
  );
}

function Empty({ height }: { readonly height: number }): ReactElement {
  return <div {...props(text.sm, styles.empty(height))}>No data</div>;
}

function Readout({
  title,
  rows,
  total,
}: {
  readonly title: string;
  readonly rows: readonly (Keyed & { readonly value: string })[];
  readonly total?: string;
}): ReactElement {
  return (
    <div {...props(text.xs, styles.readout)}>
      <span {...props(styles.readoutTitle)}>{title}</span>
      {rows.map((row) => (
        <span key={row.id} {...props(styles.readoutRow)}>
          <span {...props(styles.readoutLabel)}>
            <span aria-hidden="true" {...props(surfaceTheme[row.tint], styles.swatch)} />
            {row.id}
          </span>
          <span>{row.value}</span>
        </span>
      ))}
      {total === undefined ? null : (
        <span {...props(styles.readoutRow, styles.readoutTotal)}>
          <span>Total</span>
          <span>{total}</span>
        </span>
      )}
    </div>
  );
}

const number = (value: unknown): number => (typeof value === "number" ? value : Number(value));

const CURVES = { linear: "linear", monotone: "monotoneX", step: "stepAfter" } as const;

function SliceTip({ slice }: SliceTooltipProps<LineSeries>): ReactElement {
  const { layers } = useContext(ReadoutContext);

  return (
    <Readout
      title={slice.points[0]?.data.xFormatted ?? ""}
      rows={slice.points.map((point) => ({
        id: String(point.seriesId),
        tint: findTint(layers, String(point.seriesId)),
        value: point.data.yFormatted,
      }))}
    />
  );
}

function BarTip({ indexValue, data: datum }: BarTooltipProps<BarDatum>): ReactElement {
  const { format, layers } = useContext(ReadoutContext);

  const rows = layers.map((layer) => ({
    id: layer.label,
    tint: layer.tint,
    value: number(datum[layer.key] ?? 0),
  }));

  return (
    <Readout
      title={String(indexValue)}
      rows={rows.toReversed().map((row) => ({ ...row, value: format(row.value) }))}
      total={layers.length > 1 ? format(rows.reduce((sum, row) => sum + row.value, 0)) : undefined}
    />
  );
}

function PieTip({ datum }: PieTooltipProps<PieDatum>): ReactElement {
  const { format, layers } = useContext(ReadoutContext);

  return (
    <Readout
      title={String(datum.label)}
      rows={[
        {
          id: String(datum.id),
          tint: findTint(layers, String(datum.id)),
          value: format(datum.value),
        },
      ]}
    />
  );
}

type LineSeriesInput = {
  readonly id: string;
  readonly data: readonly { readonly x: number | string; readonly y: number }[];
  readonly tint?: Tint;
};

export function LineChart({
  series,
  height = 240,
  xFormat,
  yFormat,
  curve = "monotone",
  area = false,
  legend = series.length > 1,
}: {
  readonly series: readonly LineSeriesInput[];
  readonly height?: number;
  readonly xFormat?: Format<number | string>;
  readonly yFormat?: Format<number>;
  readonly curve?: keyof typeof CURVES;
  readonly area?: boolean;
  readonly legend?: boolean;
}): ReactElement {
  const paint = usePaint();
  const [width, setWidth] = useState(0);
  const ys = series.flatMap((serie) => serie.data.map((point) => point.y));

  if (ys.length === 0) return <Empty height={height} />;

  const categorical = series.some((serie) =>
    serie.data.some((point) => typeof point.x === "string"),
  );

  const longest = series.reduce((most, serie) => Math.max(most, serie.data.length), 0);
  const formatX = (x: number | string): string => (xFormat === undefined ? String(x) : xFormat(x));
  const formatY = (y: number): string => (yFormat === undefined ? y.toLocaleString() : yFormat(y));

  const entries = series.map((serie, index) => ({
    id: serie.id,
    tint: serie.tint ?? tintAt(index),
  }));

  const xs = [...new Set(series.flatMap((serie) => serie.data.map((point) => point.x)))];
  const margin = { ...MARGIN, left: Math.max(MARGIN.left, valueAxisWidth(ys, formatY)) };
  const plotWidth = width - margin.left - margin.right;
  const widestX = labelWidth(xs.map(formatX));
  const lowest = Math.min(...ys);

  return (
    <div {...props(styles.chart)}>
      <ReadoutContext.Provider
        value={{
          format: formatY,
          layers: entries.map((entry) => ({ key: entry.id, label: entry.id, tint: entry.tint })),
        }}
      >
        <div {...props(styles.plot(height))}>
          <ResponsiveLine
            onResize={(size) => setWidth(size.width)}
            data={series.map((serie) => ({
              id: serie.id,
              data: serie.data.map((point) => ({ x: point.x, y: point.y })),
            }))}
            margin={margin}
            xScale={categorical ? { type: "point" } : { type: "linear", min: "auto", max: "auto" }}
            yScale={{ type: "linear", min: lowest >= 0 ? 0 : "auto", max: "auto", nice: true }}
            xFormat={(value) => formatX(typeof value === "string" ? value : number(value))}
            yFormat={(value) => formatY(number(value))}
            curve={CURVES[curve]}
            colors={entries.map((entry) => paint(entry.tint))}
            lineWidth={2}
            enablePoints={longest <= 24}
            pointSize={8}
            pointBorderWidth={2}
            pointColor={role.bgBase}
            pointBorderColor={{ from: "seriesColor" }}
            enableArea={area}
            areaOpacity={0.14}
            enableGridX={false}
            gridYValues={4}
            axisLeft={{
              tickSize: 0,
              tickPadding: TICK_PADDING,
              tickValues: 4,
              format: (value) => formatY(number(value)),
            }}
            axisBottom={{
              tickSize: 0,
              tickPadding: TICK_PADDING,
              tickValues: categorical
                ? fitTicks(xs.map(String), plotWidth, widestX)
                : Math.min(longest, tickRoom(plotWidth, widestX, MAX_BOTTOM_TICKS)),
              format: (value) => formatX(typeof value === "string" ? value : number(value)),
            }}
            markers={
              lowest >= 0
                ? [
                    {
                      axis: "y",
                      value: 0,
                      lineStyle: { stroke: role.borderStrong, strokeWidth: 1 },
                    },
                  ]
                : []
            }
            layers={[
              "grid",
              "markers",
              "axes",
              "areas",
              "crosshair",
              "lines",
              "points",
              "slices",
              "mesh",
              "legends",
            ]}
            enableSlices="x"
            enableCrosshair
            crosshairType="x"
            sliceTooltip={SliceTip}
            animate={false}
            theme={theme}
            role="img"
          />
        </div>
      </ReadoutContext.Provider>
      {legend ? <Legend entries={entries} /> : null}
    </div>
  );
}

type BarKey = string | { readonly key: string; readonly label?: string; readonly tint?: Tint };

export function BarChart({
  data,
  keys,
  indexBy,
  height = 240,
  layout = "vertical",
  mode = "stacked",
  valueFormat,
  legend = keys.length > 1,
}: {
  readonly data: readonly Readonly<Record<string, number | string>>[];
  readonly keys: readonly BarKey[];
  readonly indexBy: string;
  readonly height?: number;
  readonly layout?: "vertical" | "horizontal";
  readonly mode?: "grouped" | "stacked";
  readonly valueFormat?: Format<number>;
  readonly legend?: boolean;
}): ReactElement {
  const paint = usePaint();
  const [width, setWidth] = useState(0);

  if (data.length === 0 || keys.length === 0) return <Empty height={height} />;

  const format = (value: number): string =>
    valueFormat === undefined ? value.toLocaleString() : valueFormat(value);

  const layers = keys.map((key, index) =>
    typeof key === "string"
      ? { key, label: key, tint: tintAt(index) }
      : { key: key.key, label: key.label ?? key.key, tint: key.tint ?? tintAt(index) },
  );

  const entries = layers.map((layer) => ({ id: layer.label, tint: layer.tint }));
  const horizontal = layout === "horizontal";
  const indices = data.map((datum) => String(datum[indexBy]));

  const totals = data.map((datum) =>
    mode === "stacked"
      ? layers.reduce((sum, layer) => sum + number(datum[layer.key] ?? 0), 0)
      : Math.max(...layers.map((layer) => number(datum[layer.key] ?? 0))),
  );

  const labelRoom = Math.min(
    Math.ceil(labelWidth(indices)) + TICK_PADDING,
    width <= 0 ? Number.POSITIVE_INFINITY : Math.floor(width * LABEL_SHARE),
  );

  const margin = horizontal
    ? { ...MARGIN, left: Math.max(MARGIN.left, labelRoom) }
    : { ...MARGIN, left: Math.max(MARGIN.left, valueAxisWidth(totals, format)) };

  const plotWidth = width - margin.left - margin.right;

  const valueAxisTicks = horizontal
    ? valueTicks(
        Math.min(0, ...totals),
        Math.max(0, ...totals),
        tickRoom(plotWidth, labelWidth(totals.map(format)), 5),
      )
    : 4;

  const valueAxis = {
    tickSize: 0,
    tickPadding: TICK_PADDING,
    tickValues: valueAxisTicks,
    format: (value: unknown) => format(number(value)),
  };

  return (
    <div {...props(styles.chart)}>
      <ReadoutContext.Provider value={{ format, layers }}>
        <div {...props(styles.plot(height))}>
          <ResponsiveBar
            onResize={(size) => setWidth(size.width)}
            data={data.map((datum) => ({ ...datum }))}
            keys={layers.map((layer) => layer.key)}
            indexBy={indexBy}
            layout={layout}
            groupMode={mode}
            margin={margin}
            padding={0.26}
            innerPadding={2}
            colors={layers.map((layer) => paint(layer.tint))}
            enableLabel={false}
            enableGridX={horizontal}
            enableGridY={!horizontal}
            gridYValues={horizontal ? undefined : 4}
            gridXValues={horizontal ? valueAxisTicks : undefined}
            axisLeft={
              horizontal
                ? {
                    tickSize: 0,
                    tickPadding: TICK_PADDING,
                    format: (value: unknown) => fitLabel(String(value), labelRoom - TICK_PADDING),
                  }
                : valueAxis
            }
            axisBottom={
              horizontal
                ? valueAxis
                : {
                    tickSize: 0,
                    tickPadding: TICK_PADDING,
                    tickValues: fitTicks(indices, plotWidth, labelWidth(indices)),
                  }
            }
            markers={[
              {
                axis: horizontal ? "x" : "y",
                value: 0,
                lineStyle: { stroke: role.borderStrong, strokeWidth: 1 },
              },
            ]}
            layers={["grid", "markers", "axes", "bars", "legends", "annotations"]}
            valueFormat={format}
            tooltip={BarTip}
            animate={false}
            theme={theme}
            role="img"
          />
        </div>
      </ReadoutContext.Provider>
      {legend ? <Legend entries={entries} /> : null}
    </div>
  );
}

type PieDatum = {
  readonly id: string;
  readonly value: number;
  readonly label?: string;
  readonly tint?: Tint;
};

export function PieChart({
  data,
  height = 240,
  donut = false,
  valueFormat,
  legend = true,
}: {
  readonly data: readonly PieDatum[];
  readonly height?: number;
  readonly donut?: boolean;
  readonly valueFormat?: Format<number>;
  readonly legend?: boolean;
}): ReactElement {
  const paint = usePaint();

  if (data.every((datum) => datum.value <= 0)) return <Empty height={height} />;

  const format = (value: number): string =>
    valueFormat === undefined ? value.toLocaleString() : valueFormat(value);

  const slices = data.map((datum, index) => ({
    id: datum.id,
    label: datum.label ?? datum.id,
    tint: datum.tint ?? tintAt(index),
    value: datum.value,
  }));

  const entries = slices.map((slice) => ({
    id: slice.label,
    tint: slice.tint,
    value: format(slice.value),
  }));

  return (
    <div {...props(styles.chart)}>
      <ReadoutContext.Provider
        value={{
          format,
          layers: slices.map((slice) => ({ key: slice.id, label: slice.label, tint: slice.tint })),
        }}
      >
        <div {...props(styles.plot(height))}>
          <ResponsivePie
            data={data.map((datum) => ({
              id: datum.id,
              label: datum.label ?? datum.id,
              value: datum.value,
            }))}
            margin={{ top: 10, right: 12, bottom: 10, left: 12 }}
            innerRadius={donut ? 0.62 : 0}
            padAngle={1}
            cornerRadius={2}
            activeOuterRadiusOffset={3}
            colors={slices.map((slice) => paint(slice.tint))}
            enableArcLinkLabels={false}
            enableArcLabels={false}
            valueFormat={format}
            tooltip={PieTip}
            animate={false}
            theme={theme}
            role="img"
          />
        </div>
      </ReadoutContext.Provider>
      {legend ? <Legend entries={entries} /> : null}
    </div>
  );
}
