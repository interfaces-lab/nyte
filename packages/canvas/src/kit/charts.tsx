import { ResponsiveBar } from "@nivo/bar";
import type { BarDatum, BarTooltipProps } from "@nivo/bar";
import { ResponsiveLine } from "@nivo/line";
import type { LineSeries, SliceTooltipProps } from "@nivo/line";
import { ResponsivePie } from "@nivo/pie";
import type { PieTooltipProps } from "@nivo/pie";
import { create, props } from "@stylexjs/stylex";
import { createContext, useContext } from "react";
import type { ReactElement } from "react";
import { platformScopes } from "@nyte-ai/ui/platform-colors";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import { role, shadow, type } from "@nyte-ai/ui/styles/vars.stylex";
import { useColorScheme } from "./scheme.ts";

const HUES: readonly Tint[] = [
  "blue",
  "purple",
  "teal",
  "orange",
  "green",
  "pink",
  "yellow",
  "red",
];

const MAX_BOTTOM_TICKS = 8;

const LABEL_SIZE = 11;

const styles = create({
  chart: { display: "flex", flexDirection: "column", gap: 8, minWidth: 0 },
  plot: (height: number) => ({ height: `${String(height)}px`, minWidth: 0 }),
  legend: {
    display: "flex",
    flexWrap: "wrap",
    columnGap: 12,
    rowGap: 4,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  key: { display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 },
  swatch: {
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: 2,
    backgroundColor: role.bgInteractiveStrong,
  },
  readout: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: 6,
    paddingInline: 9,
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: LABEL_SIZE,
    lineHeight: "16px",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  readoutTitle: { fontWeight: 500, paddingBlockEnd: 2 },
  readoutRow: { display: "flex", justifyContent: "space-between", gap: 16 },
  readoutLabel: { display: "flex", alignItems: "center", gap: 6, color: role.contentSecondary },
  readoutSwatch: {
    width: 6,
    height: 6,
    borderRadius: 1,
    backgroundColor: role.bgInteractiveStrong,
  },
  readoutTotal: {
    marginBlockStart: 2,
    paddingBlockStart: 2,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondary,
    fontWeight: 600,
  },
});

type Format<Value> = (value: Value) => string;

type Keyed = { readonly id: string; readonly tint: Tint };

type ReadoutContextValue = {
  readonly format: Format<number>;
  readonly layers: readonly { readonly key: string; readonly label: string; readonly tint: Tint }[];
};

const ReadoutContext = createContext<ReadoutContextValue>({
  format: (value) => value.toLocaleString(),
  layers: [],
});

const tintOf = (layers: ReadoutContextValue["layers"], key: string): Tint =>
  layers.find((layer) => layer.key === key)?.tint ?? "blue";

const theme = {
  text: {
    fontFamily: type.fontMono,
    fontSize: LABEL_SIZE,
    fill: role.contentTertiary,
    outlineWidth: 3,
    outlineColor: role.bgBase,
    outlineOpacity: 1,
  },
  axis: { ticks: { line: { strokeWidth: 0 } }, domain: { line: { strokeWidth: 0 } } },
  grid: { line: { stroke: role.borderSecondary, strokeWidth: 1 } },
  crosshair: { line: { stroke: role.borderStrong, strokeWidth: 1, strokeOpacity: 1 } },
  labels: { text: { fontWeight: 500, outlineWidth: 0 } },
};

const MARGIN = { top: 10, right: 12, bottom: 28, left: 48 };

function usePaint(): (tint: Tint) => string {
  const scheme = useColorScheme();

  return (tint) =>
    (tint === "custom" ? platformScopes[scheme].blue : platformScopes[scheme][tint])
      .bgInteractiveStrong;
}

const tintAt = (index: number): Tint => HUES[index % HUES.length] ?? "blue";

function Legend({ entries }: { readonly entries: readonly Keyed[] }): ReactElement {
  return (
    <div {...props(styles.legend)}>
      {entries.map((entry) => (
        <span key={entry.id} {...props(styles.key)}>
          <span aria-hidden="true" {...props(surfaceTheme[entry.tint], styles.swatch)} />
          {entry.id}
        </span>
      ))}
    </div>
  );
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
    <div {...props(styles.readout)}>
      <span {...props(styles.readoutTitle)}>{title}</span>
      {rows.map((row) => (
        <span key={row.id} {...props(styles.readoutRow)}>
          <span {...props(styles.readoutLabel)}>
            <span aria-hidden="true" {...props(surfaceTheme[row.tint], styles.readoutSwatch)} />
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

function thinned<Value>(values: readonly Value[]): readonly Value[] {
  const step = Math.ceil(values.length / MAX_BOTTOM_TICKS);

  return values.filter((_, index) => index % step === 0 || index === values.length - 1);
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
        tint: tintOf(layers, String(point.seriesId)),
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
          tint: tintOf(layers, String(datum.id)),
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
  const categories = categorical
    ? thinned([...new Set(series.flatMap((serie) => serie.data.map((point) => String(point.x))))])
    : undefined;
  const lowest = Math.min(...series.flatMap((serie) => serie.data.map((point) => point.y)));

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
            data={series.map((serie) => ({
              id: serie.id,
              data: serie.data.map((point) => ({ x: point.x, y: point.y })),
            }))}
            margin={MARGIN}
            xScale={categorical ? { type: "point" } : { type: "linear", min: "auto", max: "auto" }}
            yScale={{ type: "linear", min: lowest >= 0 ? 0 : "auto", max: "auto", nice: true }}
            xFormat={(value) => formatX(typeof value === "string" ? value : number(value))}
            yFormat={(value) => formatY(number(value))}
            curve={CURVES[curve]}
            colors={entries.map((entry) => paint(entry.tint))}
            lineWidth={1.5}
            enablePoints={longest <= 24}
            pointSize={6}
            pointBorderWidth={2}
            pointColor={role.bgBase}
            pointBorderColor={{ from: "seriesColor" }}
            enableArea={area}
            areaOpacity={0.14}
            enableGridX={false}
            gridYValues={4}
            axisLeft={{
              tickSize: 0,
              tickPadding: 6,
              tickValues: 4,
              format: (value) => formatY(number(value)),
            }}
            axisBottom={{
              tickSize: 0,
              tickPadding: 8,
              ...(categories === undefined
                ? { tickValues: Math.min(MAX_BOTTOM_TICKS, longest) }
                : { tickValues: categories }),
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

type BarKey =
  | string
  | { readonly key: string; readonly label?: string; readonly tint?: Tint };

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
  const format = (value: number): string =>
    valueFormat === undefined ? value.toLocaleString() : valueFormat(value);
  const layers = keys.map((key, index) =>
    typeof key === "string"
      ? { key, label: key, tint: tintAt(index) }
      : { key: key.key, label: key.label ?? key.key, tint: key.tint ?? tintAt(index) },
  );
  const entries = layers.map((layer) => ({ id: layer.label, tint: layer.tint }));
  const horizontal = layout === "horizontal";
  const indices = thinned(data.map((datum) => String(datum[indexBy])));
  const valueAxis = {
    tickSize: 0,
    tickPadding: 6,
    tickValues: 4,
    format: (value: unknown) => format(number(value)),
  };

  return (
    <div {...props(styles.chart)}>
      <ReadoutContext.Provider value={{ format, layers }}>
        <div {...props(styles.plot(height))}>
          <ResponsiveBar
            data={data.map((datum) => ({ ...datum }))}
            keys={layers.map((layer) => layer.key)}
            indexBy={indexBy}
            layout={layout}
            groupMode={mode}
            margin={horizontal ? { ...MARGIN, left: 80 } : MARGIN}
            padding={0.26}
            innerPadding={mode === "grouped" ? 2 : 0}
            colors={layers.map((layer) => paint(layer.tint))}
            enableLabel={false}
            enableGridX={horizontal}
            enableGridY={!horizontal}
            gridYValues={horizontal ? undefined : 4}
            gridXValues={horizontal ? 4 : undefined}
            axisLeft={horizontal ? { tickSize: 0, tickPadding: 8 } : valueAxis}
            axisBottom={
              horizontal ? valueAxis : { tickSize: 0, tickPadding: 8, tickValues: indices }
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
  const scheme = useColorScheme();
  const format = (value: number): string =>
    valueFormat === undefined ? value.toLocaleString() : valueFormat(value);
  const slices = data.map((datum, index) => ({
    id: datum.id,
    label: datum.label ?? datum.id,
    tint: datum.tint ?? tintAt(index),
  }));
  const entries = slices.map((slice) => ({ id: slice.label, tint: slice.tint }));

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
            enableArcLabels
            arcLabelsSkipAngle={18}
            arcLabelsTextColor={{
              from: "color",
              modifiers: [scheme === "dark" ? ["brighter", 2.4] : ["darker", 2.2]],
            }}
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
