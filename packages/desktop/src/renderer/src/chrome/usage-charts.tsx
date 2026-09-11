/**
 * The chart layer for Settings › Usage. nivo draws into SVG presentation
 * attributes, which never resolve a CSS variable, so the palette is read off
 * the document once per theme and handed over as literal colors.
 *
 * Every chart here is deliberately quiet: no legends, no domain lines, one
 * dashed axis, and a readout that only appears under the pointer. The card
 * header carries the numbers; the chart carries the shape.
 */
import { ResponsiveBar } from "@nivo/bar";
import { ResponsiveTimeRange } from "@nivo/calendar";
import { linearGradientDef } from "@nivo/core";
import type { PartialTheme } from "@nivo/theming";
import { ResponsiveLine } from "@nivo/line";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { t } from "../theme/vars.stylex.ts";
import { useAppearanceSettings } from "../theme/use-appearance.ts";
import {
  dayLabel,
  formatCount,
  formatPercent,
  formatTokens,
  formatUsd,
  formatUsdCompact,
  TOKEN_KINDS,
  TOKEN_KIND_LABELS,
  type TokenKind,
  type UsageCalendar,
  type UsageModelRow,
  type UsagePoint,
} from "./usage-view.ts";

export interface ChartPalette {
  readonly axis: string;
  readonly grid: string;
  readonly crosshair: string;
  readonly track: string;
  readonly accent: string;
  readonly tokens: Readonly<Record<TokenKind, string>>;
  readonly series: readonly string[];
  readonly heat: readonly string[];
}

const SERIES_VARS = [
  "--nyte-accent",
  "--nyte-purple",
  "--nyte-cyan",
  "--nyte-orange",
  "--nyte-green",
  "--nyte-magenta",
] as const;

/** How much of the accent each heat step carries; the rest is the card behind it. */
const HEAT_STEPS = [16, 34, 52, 72, 100];

function readVar(styles: CSSStyleDeclaration, name: string): string {
  return styles.getPropertyValue(name).trim();
}

function readChartPalette(): ChartPalette {
  const styles = getComputedStyle(document.documentElement);
  const series = SERIES_VARS.map((name) => readVar(styles, name));
  const accent = series[0] ?? "#1084fe";
  return {
    axis: readVar(styles, "--nyte-text-quaternary"),
    grid: readVar(styles, "--nyte-stroke-quaternary"),
    crosshair: readVar(styles, "--nyte-stroke-secondary"),
    track: readVar(styles, "--sand-fill-secondary"),
    accent,
    tokens: {
      input: accent,
      output: series[1] ?? accent,
      cacheRead: series[2] ?? accent,
      cacheWrite: series[3] ?? accent,
    },
    series,
    heat: HEAT_STEPS.map(
      (percent) => `color-mix(in srgb, ${accent} ${String(percent)}%, transparent)`,
    ),
  };
}

const colorScheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)");

/**
 * The appearance store applies a system scheme change to the document without
 * telling its subscribers, so the palette listens to the query itself.
 */
function subscribeColorScheme(listener: () => void): () => void {
  colorScheme?.addEventListener("change", listener);
  return () => colorScheme?.removeEventListener("change", listener);
}

function colorSchemeIsDark(): boolean {
  return colorScheme?.matches ?? false;
}

export function useChartPalette(): ChartPalette {
  const appearance = useAppearanceSettings();
  const systemDark = useSyncExternalStore(
    subscribeColorScheme,
    colorSchemeIsDark,
    colorSchemeIsDark,
  );
  return useMemo(
    () => readChartPalette(),
    // The palette is the document's; these are the inputs that repaint it.
    [appearance.theme, appearance.tintHue, appearance.tintIntensity, systemDark],
  );
}

const AXIS_FONT_SIZE = 10;

function chartTheme(palette: ChartPalette): PartialTheme {
  return {
    text: {
      fontFamily: "inherit",
      fontSize: AXIS_FONT_SIZE,
      fill: palette.axis,
      outlineWidth: 0,
      outlineColor: "transparent",
    },
    axis: {
      domain: { line: { stroke: "transparent" } },
      ticks: {
        line: { stroke: "transparent" },
        text: { fontSize: AXIS_FONT_SIZE, fill: palette.axis, fontVariantNumeric: "tabular-nums" },
      },
    },
    grid: { line: { stroke: palette.grid, strokeWidth: 1, strokeDasharray: "2 4" } },
    crosshair: {
      line: { stroke: palette.crosshair, strokeWidth: 1, strokeOpacity: 1, strokeDasharray: "3 3" },
    },
    tooltip: { container: { background: "transparent", boxShadow: "none", padding: 0 } },
  };
}

const styles = stylex.create({
  fill: { width: "100%", height: "100%" },
  tooltip: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 116,
    padding: "7px 9px",
    borderRadius: t.radiusLg,
    backgroundColor: t.bgElevated,
    boxShadow: `${t.shadowPopover}, inset 0 0 0 1px ${t.strokeSecondary}`,
    color: t.textPrimary,
    fontFamily: t.fontSans,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    pointerEvents: "none",
  },
  tooltipTitle: {
    color: t.textTertiary,
    fontSize: t.fontXs,
    lineHeight: t.leadingXs,
    letterSpacing: t.letterBase,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  tooltipRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
  },
  tooltipSwatch: {
    width: 7,
    height: 7,
    borderRadius: t.radiusFull,
    flexShrink: 0,
  },
  tooltipLabel: { flex: 1, color: t.textSecondary, whiteSpace: "nowrap" },
  tooltipValue: {
    color: t.textPrimary,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
    whiteSpace: "nowrap",
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    color: t.textQuaternary,
    fontSize: t.fontSm,
    lineHeight: t.leadingSm,
    textAlign: "center",
    textWrap: "pretty",
  },
});

interface ChartReadoutRow {
  readonly label: string;
  readonly value: string;
  readonly color?: string;
}

function ChartReadout({
  title,
  rows,
}: {
  readonly title: string;
  readonly rows: readonly ChartReadoutRow[];
}): ReactElement {
  return (
    <div {...stylex.props(styles.tooltip)}>
      <span {...stylex.props(styles.tooltipTitle)}>{title}</span>
      {rows.map((row) => (
        <span key={row.label} {...stylex.props(styles.tooltipRow)}>
          {row.color !== undefined && (
            <span
              {...stylex.props(styles.tooltipSwatch)}
              style={{ backgroundColor: row.color }}
              aria-hidden="true"
            />
          )}
          <span {...stylex.props(styles.tooltipLabel)}>{row.label}</span>
          <span {...stylex.props(styles.tooltipValue)}>{row.value}</span>
        </span>
      ))}
    </div>
  );
}

export function ChartEmpty({ message }: { readonly message: string }): ReactElement {
  return <p {...stylex.props(styles.empty)}>{message}</p>;
}

/** A bar's kind, or the accent when a build adds a key this palette has no color for. */
function tokenKind(id: string | number): TokenKind | undefined {
  return TOKEN_KINDS.find((candidate) => candidate === id);
}

/** At most this many bottom ticks; more than that and the labels collide. */
export const MAX_TICKS = 5;

function spacedTicks(points: readonly UsagePoint[]): readonly string[] {
  if (points.length <= MAX_TICKS) return points.map((point) => point.key);
  const step = Math.ceil(points.length / MAX_TICKS);
  return points.filter((_point, index) => index % step === 0).map((point) => point.key);
}

function labelFor(points: readonly UsagePoint[], key: string | number): string {
  return points.find((point) => point.key === key)?.label ?? String(key);
}

/** Range toggles would replay nivo's grow-in; the page is meant to stay still. */
const ANIMATE = false;

/** Horizontal gridlines under a time series, and vertical ones under the model bars. */
export const TIME_GRID_LINES = 4;
export const MODEL_GRID_LINES = 3;

export const SPEND_MARGIN = { top: 8, right: 4, bottom: 20, left: 38 };

export function SpendChart({
  points,
  palette,
}: {
  readonly points: readonly UsagePoint[];
  readonly palette: ChartPalette;
}): ReactElement {
  const theme = useMemo(() => chartTheme(palette), [palette]);
  const series = useMemo(
    () => [{ id: "spend", data: points.map((point) => ({ x: point.key, y: point.cost })) }],
    [points],
  );
  const ticks = spacedTicks(points);

  return (
    <div {...stylex.props(styles.fill)}>
      <ResponsiveLine
        data={series}
        theme={theme}
        animate={ANIMATE}
        margin={SPEND_MARGIN}
        xScale={{ type: "point" }}
        yScale={{ type: "linear", min: 0, max: "auto", stacked: false }}
        curve="monotoneX"
        colors={[palette.accent]}
        lineWidth={1.5}
        enablePoints={false}
        enableArea={true}
        areaOpacity={1}
        defs={[
          linearGradientDef("usage-spend", [
            { offset: 0, color: palette.accent, opacity: 0.28 },
            { offset: 100, color: palette.accent, opacity: 0 },
          ]),
        ]}
        fill={[{ match: "*", id: "usage-spend" }]}
        enableGridX={false}
        gridYValues={TIME_GRID_LINES}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          tickValues: TIME_GRID_LINES,
          format: (value: number) => formatUsdCompact(value),
        }}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          tickValues: [...ticks],
          format: (value: string | number) => labelFor(points, value),
        }}
        enableSlices="x"
        enableCrosshair={true}
        crosshairType="x"
        useMesh={true}
        sliceTooltip={({ slice }) => (
          <ChartReadout
            title={labelFor(points, slice.points[0]?.data.x ?? "")}
            rows={[
              {
                label: "Spend",
                value: formatUsd(Number(slice.points[0]?.data.y ?? 0)),
                color: palette.accent,
              },
            ]}
          />
        )}
        role="img"
        ariaLabel="Spend over time"
      />
    </div>
  );
}

export const TOKENS_MARGIN = { top: 8, right: 4, bottom: 20, left: 38 };

export function TokensChart({
  points,
  palette,
}: {
  readonly points: readonly UsagePoint[];
  readonly palette: ChartPalette;
}): ReactElement {
  const theme = useMemo(() => chartTheme(palette), [palette]);
  const data = useMemo(() => [...points], [points]);
  const ticks = spacedTicks(points);

  return (
    <div {...stylex.props(styles.fill)}>
      <ResponsiveBar
        data={data}
        theme={theme}
        animate={ANIMATE}
        keys={[...TOKEN_KINDS]}
        indexBy="key"
        margin={TOKENS_MARGIN}
        padding={points.length > 40 ? 0.15 : 0.35}
        colors={({ id }) => {
          const kind = tokenKind(id);
          return kind === undefined ? palette.accent : palette.tokens[kind];
        }}
        borderRadius={1.5}
        enableLabel={false}
        enableGridY={true}
        gridYValues={TIME_GRID_LINES}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          tickValues: TIME_GRID_LINES,
          format: (value: number) => formatTokens(value),
        }}
        axisBottom={{
          tickSize: 0,
          tickPadding: 8,
          tickValues: [...ticks],
          format: (value: string | number) => labelFor(points, value),
        }}
        tooltip={({ id, value, indexValue }) => {
          const kind = tokenKind(id);
          return (
            <ChartReadout
              title={labelFor(points, indexValue)}
              rows={[
                {
                  label: kind === undefined ? String(id) : TOKEN_KIND_LABELS[kind],
                  value: formatCount(value),
                  color: kind === undefined ? palette.accent : palette.tokens[kind],
                },
              ]}
            />
          );
        }}
        role="img"
        ariaLabel="Tokens by kind over time"
      />
    </div>
  );
}

export const MODELS_MARGIN = { top: 2, right: 6, bottom: 18, left: 96 };

/** More rows than this and the labels stop fitting; the card lists the rest. */
export const MODEL_BAR_LIMIT = 5;

export function ModelsChart({
  models,
  palette,
}: {
  readonly models: readonly UsageModelRow[];
  readonly palette: ChartPalette;
}): ReactElement {
  const theme = useMemo(() => chartTheme(palette), [palette]);
  const colorOf = useMemo(() => {
    const assigned = new Map<string, string>();
    models.forEach((model, index) => {
      assigned.set(model.key, palette.series[index % palette.series.length] ?? palette.accent);
    });
    return assigned;
  }, [models, palette]);
  // Bars run bottom-up, so the leading model has to be the last row.
  const data = useMemo(
    () =>
      models
        .slice(0, MODEL_BAR_LIMIT)
        .map((model) => ({
          key: model.key,
          label: model.model,
          provider: model.provider,
          cost: model.cost,
          share: model.share,
        }))
        .toReversed(),
    [models],
  );

  return (
    <div {...stylex.props(styles.fill)}>
      <ResponsiveBar
        data={data}
        theme={theme}
        animate={ANIMATE}
        keys={["cost"]}
        indexBy="key"
        layout="horizontal"
        margin={MODELS_MARGIN}
        padding={0.34}
        colors={({ indexValue }) => colorOf.get(String(indexValue)) ?? palette.accent}
        borderRadius={2}
        enableLabel={false}
        enableGridX={true}
        enableGridY={false}
        gridXValues={MODEL_GRID_LINES}
        axisLeft={{
          tickSize: 0,
          tickPadding: 8,
          truncateTickAt: 88,
          format: (value: string | number) =>
            models.find((model) => model.key === value)?.model ?? String(value),
        }}
        axisBottom={{
          tickSize: 0,
          tickPadding: 6,
          tickValues: MODEL_GRID_LINES,
          format: (value: number) => formatUsdCompact(value),
        }}
        tooltip={({ data: bar, value }) => (
          <ChartReadout
            title={bar.label}
            rows={[
              // Two providers can serve the same model id, so the readout names
              // which one this bar is.
              { label: "Provider", value: String(bar.provider) },
              {
                label: "Spend",
                value: formatUsd(value),
                color: colorOf.get(bar.key) ?? palette.accent,
              },
              { label: "Share", value: formatPercent(Number(bar.share ?? 0)) },
            ]}
          />
        )}
        role="img"
        ariaLabel="Spend by model"
      />
    </div>
  );
}

export const ACTIVITY_MARGIN = { top: 6, right: 4, bottom: 4, left: 22 };

/** Gap between day cells, and the gutter the weekday ticks are written into. */
export const DAY_SPACING = 3;
export const WEEKDAY_GUTTER = 54;

/** Which of the seven rows are named; the rest are read from their neighbours. */
export const WEEKDAY_TICKS = [1, 3, 5] as const;

export function ActivityChart({
  calendar,
  palette,
}: {
  readonly calendar: UsageCalendar;
  readonly palette: ChartPalette;
}): ReactElement {
  const theme = useMemo(() => chartTheme(palette), [palette]);
  const data = useMemo(
    () => calendar.data.map((entry) => ({ day: entry.day, value: entry.value })),
    [calendar],
  );

  return (
    <div {...stylex.props(styles.fill)} role="img" aria-label="Activity by day">
      <ResponsiveTimeRange
        data={data}
        theme={theme}
        from={calendar.from}
        to={calendar.to}
        margin={ACTIVITY_MARGIN}
        align="top"
        colors={[...palette.heat]}
        emptyColor={palette.track}
        dayBorderWidth={0}
        daySpacing={DAY_SPACING}
        dayRadius={2}
        weekdayTicks={[...WEEKDAY_TICKS]}
        weekdayLegendOffset={WEEKDAY_GUTTER}
        firstWeekday="monday"
        monthLegendOffset={10}
        role="presentation"
        tooltip={({ day, value, color }) => (
          <ChartReadout
            title={dayLabel(day)}
            rows={[{ label: "Tokens", value: formatCount(Number(value)), color }]}
          />
        )}
      />
    </div>
  );
}
