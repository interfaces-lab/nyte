/**
 * The usage charts: a stacked bar per bucket, a sparkline for a table row, and
 * a trace for a limit window. Each paints in a fixed order, grid then fills
 * then lines then nodes then labels, so an edge is never under a bar and a
 * label is never under an edge. Labels carry a halo in the panel colour so
 * they stay legible where they cross a line.
 */
import { create, props } from "@stylexjs/stylex";
import { useCallback, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { useClientBox } from "@nyte-ai/app/workbench/use-client-box.ts";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import { role, shadow, type } from "@nyte-ai/ui/vars.stylex";
import {
  TOKEN_KINDS,
  TOKEN_LABELS,
  sumOf,
  type Account,
  type Tally,
  type TokenKind,
} from "./fixtures";
import { bucketLabel, bucketTitle, delta, pct, project, tokens, usd, usdTick } from "./format";
import { dataFont, textWidth, useFamily, widest } from "./measure";

export const KIND_TINT = {
  input: "blue",
  output: "purple",
  cacheRead: "teal",
  cacheWrite: "orange",
} as const satisfies Readonly<Record<TokenKind, Tint>>;

export type Metric = "cost" | "tokens";

export const readKind = (tally: Tally, metric: Metric, kind: TokenKind): number =>
  metric === "cost" ? tally.cost[kind] : tally.tokens[kind];

export const readTotal = (tally: Tally, metric: Metric): number =>
  sumOf(metric === "cost" ? tally.cost : tally.tokens);

/** Share of prompt tokens served from cache. */
export const hitRate = (tally: Tally): number => {
  const prompt = tally.tokens.input + tally.tokens.cacheRead + tally.tokens.cacheWrite;

  return prompt === 0 ? 0 : tally.tokens.cacheRead / prompt;
};

/** Steps of 1, 2 or 5 at the value's magnitude, so ticks read as round numbers. */
function niceTicks(max: number, count: number): number[] {
  const raw = Math.max(max, Number.EPSILON) / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const step = (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;

  return Array.from({ length: Math.ceil(max / step) + 1 }, (_slot, index) => index * step);
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const polyline = (points: readonly (readonly [number, number])[]): string =>
  points
    .map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");

function useBox() {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [observe, width] = useClientBox();

  const attach = useCallback(
    (next: HTMLDivElement | null) => {
      observe(next);
      setNode(next);
    },
    [observe],
  );

  return { attach, width, family: useFamily(node) };
}

function Label({
  x,
  y,
  anchor = "middle",
  strong = false,
  children,
}: {
  readonly x: number;
  readonly y: number;
  readonly anchor?: "start" | "middle" | "end";
  readonly strong?: boolean;
  readonly children: ReactNode;
}): ReactElement {
  return (
    <text x={x} y={y} textAnchor={anchor} {...props(styles.label, strong && styles.labelStrong)}>
      {children}
    </text>
  );
}

const HEIGHT = 232;

const TOP = 10;

const AXIS = 22;

/**
 * Spend or tokens per bucket, stacked by kind, with the previous period as a
 * dashed step behind it. The token view adds the cache hit rate on its own axis.
 */
export function StackedChart({
  current,
  previous,
  starts,
  unit,
  metric,
  emphasis,
}: {
  readonly current: readonly Tally[];
  readonly previous: readonly Tally[];
  readonly starts: readonly number[];
  readonly unit: "hour" | "day";
  readonly metric: Metric;
  readonly emphasis: TokenKind | null;
}): ReactElement {
  const { attach, width, family } = useBox();
  const [active, setActive] = useState<number | null>(null);

  return (
    <div ref={attach} {...props(styles.plot)} style={{ height: HEIGHT }}>
      {family !== null && width > 0 && (
        <StackedPlot
          current={current}
          previous={previous}
          starts={starts}
          unit={unit}
          metric={metric}
          emphasis={emphasis}
          width={width}
          family={family}
          active={active}
          onActive={setActive}
        />
      )}
    </div>
  );
}

function StackedPlot({
  current,
  previous,
  starts,
  unit,
  metric,
  emphasis,
  width,
  family,
  active,
  onActive,
}: {
  readonly current: readonly Tally[];
  readonly previous: readonly Tally[];
  readonly starts: readonly number[];
  readonly unit: "hour" | "day";
  readonly metric: Metric;
  readonly emphasis: TokenKind | null;
  readonly width: number;
  readonly family: string;
  readonly active: number | null;
  readonly onActive: (index: number | null) => void;
}): ReactElement {
  const font = dataFont(family);
  const n = current.length;
  const format = metric === "cost" ? usdTick : tokens;
  const totals = current.map((tally) => readTotal(tally, metric));
  const before = previous.map((tally) => readTotal(tally, metric));
  const ticks = niceTicks(Math.max(...totals, ...before), 4);
  const top = ticks.at(-1) ?? 1;
  const showHit = metric === "tokens";
  const left = widest(ticks.map(format), font) + 8;
  const right = showHit ? widest(["100%"], font) + 8 : 0;
  const plotWidth = width - left - right;
  const plotHeight = HEIGHT - TOP - AXIS;
  const slot = plotWidth / n;
  const bar = Math.max(1, Math.min(slot - (slot > 6 ? 2 : 0), slot * 0.78));
  const x = (index: number): number => left + slot * index;
  const y = (value: number): number => TOP + plotHeight * (1 - value / top);
  const yShare = (share: number): number => TOP + plotHeight * (1 - share);
  const labels = starts.map((start) => bucketLabel(start, unit));
  // Every nth bucket is labelled, n picked so the widest label clears its neighbour.
  const every = Math.max(1, Math.ceil((widest(labels, font) + 12) / slot));
  const focus = active === null ? undefined : current[active];
  const prior = active === null ? undefined : previous[active];

  const step = before.flatMap((value, index) => [
    [x(index), y(value)] as const,
    [x(index + 1), y(value)] as const,
  ]);

  const hits = current.map(
    (tally, index) => [x(index) + slot / 2, yShare(hitRate(tally))] as const,
  );

  return (
    <>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${metric === "cost" ? "Spend" : "Tokens"} per ${unit}, by kind`}
        tabIndex={0}
        {...props(styles.svg)}
        onPointerMove={(event: PointerEvent<SVGSVGElement>) => {
          const box = event.currentTarget.getBoundingClientRect();

          onActive(clamp(Math.floor((event.clientX - box.left - left) / slot), 0, n - 1));
        }}
        onPointerLeave={() => onActive(null)}
        onKeyDown={(event: KeyboardEvent) => {
          if (event.key === "ArrowRight") onActive(clamp((active ?? -1) + 1, 0, n - 1));

          if (event.key === "ArrowLeft") onActive(clamp((active ?? n) - 1, 0, n - 1));
        }}
        onBlur={() => onActive(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={left}
              x2={left + plotWidth}
              y1={y(tick)}
              y2={y(tick)}
              {...props(tick === 0 ? styles.baseline : styles.grid)}
            />
            <Label x={left - 6} y={y(tick) + 3.5} anchor="end">
              {format(tick)}
            </Label>
          </g>
        ))}
        {showHit &&
          [0.5, 1].map((share) => (
            <Label key={share} x={width} y={yShare(share) + 3.5} anchor="end">
              {pct(share)}
            </Label>
          ))}
        {active !== null && (
          <rect x={x(active)} y={TOP} width={slot} height={plotHeight} {...props(styles.column)} />
        )}
        {current.map((tally, index) => {
          let floor = 0;

          return (
            <g key={starts[index]} {...props(active !== null && active !== index && styles.recede)}>
              {TOKEN_KINDS.map((kind) => {
                const value = readKind(tally, metric, kind);
                const from = floor;

                floor += value;

                return (
                  <rect
                    key={kind}
                    x={x(index) + (slot - bar) / 2}
                    y={y(from + value)}
                    width={bar}
                    height={Math.max(0, y(from) - y(from + value))}
                    {...props(
                      surfaceTheme[KIND_TINT[kind]],
                      styles.segment,
                      emphasis !== null && emphasis !== kind && styles.faded,
                    )}
                  />
                );
              })}
            </g>
          );
        })}
        <path d={polyline(step)} {...props(styles.previous)} />
        {showHit && <path d={polyline(hits)} {...props(styles.hitLine)} />}
        {showHit && focus !== undefined && active !== null && (
          <circle
            cx={x(active) + slot / 2}
            cy={yShare(hitRate(focus))}
            r={3}
            {...props(styles.hitNode)}
          />
        )}
        {labels.map((label, index) =>
          (n - 1 - index) % every === 0 ? (
            <Label
              key={starts[index]}
              x={x(index) + slot / 2}
              y={HEIGHT - 6}
              strong={index === active}
            >
              {label}
            </Label>
          ) : null,
        )}
      </svg>
      {focus !== undefined && active !== null && (
        <Readout
          anchor={x(active) + slot}
          width={width}
          family={family}
          title={bucketTitle(starts[active] ?? 0, unit)}
          rows={[
            ...TOKEN_KINDS.toReversed().map((kind) => ({
              key: kind,
              tint: KIND_TINT[kind],
              label: TOKEN_LABELS[kind],
              value: metric === "cost" ? usd(focus.cost[kind]) : tokens(focus.tokens[kind]),
            })),
            {
              key: "total",
              tint: null,
              label: "Total",
              value: metric === "cost" ? usd(totals[active] ?? 0) : tokens(totals[active] ?? 0),
            },
            ...(prior === undefined
              ? []
              : [
                  {
                    key: "prev",
                    tint: null,
                    label: "Prev",
                    value: `${metric === "cost" ? usd(before[active] ?? 0) : tokens(before[active] ?? 0)} ${delta(totals[active] ?? 0, before[active] ?? 0).text}`,
                  },
                ]),
            ...(showHit
              ? [{ key: "hit", tint: null, label: "Hit", value: pct(hitRate(focus), 1) }]
              : []),
          ]}
        />
      )}
    </>
  );
}

/** A small table beside the pointer, measured before it is placed so it flips instead of clipping. */
function Readout({
  anchor,
  width,
  family,
  title,
  rows,
}: {
  readonly anchor: number;
  readonly width: number;
  readonly family: string;
  readonly title: string;
  readonly rows: readonly {
    readonly key: string;
    readonly tint: Tint | null;
    readonly label: string;
    readonly value: string;
  }[];
}): ReactElement {
  const font = dataFont(family);

  const labelWidth = widest(
    rows.map((row) => row.label),
    font,
  );

  const valueWidth = widest(
    rows.map((row) => row.value),
    font,
  );

  const boxWidth =
    Math.max(textWidth(title, dataFont(family, 500)), 12 + labelWidth + 16 + valueWidth) + 18;

  const left = anchor + 8 + boxWidth > width ? anchor - 8 - boxWidth - 16 : anchor + 8;

  return (
    <div
      aria-hidden="true"
      {...props(styles.readout)}
      style={{ left: Math.max(0, left), width: boxWidth }}
    >
      <span {...props(styles.readoutTitle)}>{title}</span>
      {rows.map((row) => (
        <span
          key={row.key}
          {...props(styles.readoutRow, row.key === "total" && styles.readoutTotal)}
        >
          <span {...props(styles.readoutLabel)}>
            {row.tint === null ? (
              <span {...props(styles.swatchSpace)} />
            ) : (
              <span {...props(surfaceTheme[row.tint], styles.swatch)} />
            )}
            {row.label}
          </span>
          <span>{row.value}</span>
        </span>
      ))}
    </div>
  );
}

const SPARK_WIDTH = 72;

const SPARK_HEIGHT = 16;

/** A row's trend across the period, scaled to its own peak. */
export function Sparkline({
  values,
  tint,
}: {
  readonly values: readonly number[];
  readonly tint: Tint;
}): ReactElement {
  const peak = Math.max(...values, Number.EPSILON);
  const stepX = SPARK_WIDTH / Math.max(values.length - 1, 1);

  const points = values.map(
    (value, index) => [index * stepX, 1 + (SPARK_HEIGHT - 2) * (1 - value / peak)] as const,
  );

  const last = points.at(-1);

  return (
    <svg width={SPARK_WIDTH} height={SPARK_HEIGHT} aria-hidden="true" {...props(styles.spark)}>
      <path
        d={`${polyline(points)} L${String(SPARK_WIDTH)},${String(SPARK_HEIGHT)} L0,${String(SPARK_HEIGHT)} Z`}
        {...props(surfaceTheme[tint], styles.sparkArea)}
      />
      <path d={polyline(points)} {...props(surfaceTheme[tint], styles.sparkLine)} />
      {last !== undefined && (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={1.75}
          {...props(surfaceTheme[tint], styles.sparkNode)}
        />
      )}
    </svg>
  );
}

export const TRACE_WIDTH = 120;

/** A limit window end to end: used so far, then the current pace carried to the reset. */
export function LimitTrace({
  account,
  tint,
}: {
  readonly account: Account;
  readonly tint: Tint;
}): ReactElement {
  const { used, atReset, fillsIn } = project(account);
  const now = account.samples.length - 1;
  const x = (step: number): number => (step / account.steps) * TRACE_WIDTH;
  const y = (value: number): number => 1 + (SPARK_HEIGHT - 2) * (1 - Math.min(value, 100) / 100);
  const fullAt = fillsIn === null ? null : now + fillsIn / account.stepMinutes;

  const end =
    fullAt === null ? ([x(account.steps), y(atReset)] as const) : ([x(fullAt), y(100)] as const);

  return (
    <svg width={TRACE_WIDTH} height={SPARK_HEIGHT} aria-hidden="true" {...props(styles.spark)}>
      <line x1={0} x2={TRACE_WIDTH} y1={y(100)} y2={y(100)} {...props(styles.grid)} />
      <line
        x1={0}
        x2={TRACE_WIDTH}
        y1={SPARK_HEIGHT - 0.5}
        y2={SPARK_HEIGHT - 0.5}
        {...props(styles.baseline)}
      />
      {fullAt !== null && (
        <rect
          x={x(fullAt)}
          y={0}
          width={TRACE_WIDTH - x(fullAt)}
          height={SPARK_HEIGHT}
          {...props(surfaceTheme[tint], styles.zone)}
        />
      )}
      <line
        x1={x(now)}
        x2={end[0]}
        y1={y(used)}
        y2={end[1]}
        {...props(surfaceTheme[tint], styles.projection)}
      />
      <path
        d={polyline(account.samples.map((sample, step) => [x(step), y(sample)] as const))}
        {...props(surfaceTheme[tint], styles.sparkLine)}
      />
      <circle cx={x(now)} cy={y(used)} r={2} {...props(surfaceTheme[tint], styles.sparkNode)} />
    </svg>
  );
}

const styles = create({
  plot: { position: "relative", minWidth: 0 },
  svg: {
    display: "block",
    overflow: "visible",
    outline: "none",
    borderRadius: radius.indicator,
    boxShadow: { default: null, ":focus-visible": `0 0 0 2px ${role.borderInteractivePrimary}` },
  },
  label: {
    fontFamily: type.fontMono,
    // DATA_SIZE: StyleX needs the literal, and Pretext measures at this size.
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    fill: role.contentTertiary,
    // The halo: a stroke in the panel colour, painted under the fill.
    stroke: role.bgBase,
    strokeWidth: 3,
    strokeLinejoin: "round",
    paintOrder: "stroke",
    pointerEvents: "none",
  },
  labelStrong: { fill: role.contentPrimary },
  grid: { stroke: role.borderSecondary, strokeWidth: 1 },
  baseline: { stroke: role.borderStrong, strokeWidth: 1 },
  column: { fill: role.bgHover },
  segment: {
    fill: role.bgInteractiveStrong,
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  faded: { opacity: 0.18 },
  recede: { opacity: 0.55 },
  previous: { fill: "none", stroke: role.contentSecondary, strokeWidth: 1, strokeDasharray: "2 2" },
  hitLine: { fill: "none", stroke: role.contentPrimary, strokeWidth: 1.5, strokeLinejoin: "round" },
  hitNode: { fill: role.contentPrimary, stroke: role.bgBase, strokeWidth: 2 },
  readout: {
    position: "absolute",
    insetBlockStart: TOP,
    zIndex: 1,
    display: "flex",
    flexDirection: "column",
    paddingBlock: 6,
    paddingInline: 9,
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    fontFamily: type.fontMono,
    // DATA_SIZE, measured by Pretext.
    fontSize: 11,
    lineHeight: "16px",
    fontVariantNumeric: "tabular-nums",
    pointerEvents: "none",
    whiteSpace: "nowrap",
  },
  readoutTitle: { color: role.contentPrimary, fontWeight: 500, paddingBlockEnd: 2 },
  readoutRow: {
    display: "flex",
    justifyContent: "space-between",
    gap: 16,
    color: role.contentPrimary,
  },
  readoutTotal: {
    marginBlockStart: 2,
    paddingBlockStart: 2,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: role.borderSecondary,
    fontWeight: 600,
  },
  readoutLabel: { display: "flex", alignItems: "center", gap: 6, color: role.contentSecondary },
  swatch: { width: 6, height: 6, borderRadius: 1, backgroundColor: role.bgInteractiveStrong },
  swatchSpace: { width: 6 },
  spark: { display: "block", overflow: "visible" },
  sparkArea: { fill: role.bgInteractiveStrong, fillOpacity: 0.14 },
  sparkLine: {
    fill: "none",
    stroke: role.bgInteractiveStrong,
    strokeWidth: 1.25,
    strokeLinejoin: "round",
  },
  sparkNode: { fill: role.bgInteractiveStrong },
  projection: { stroke: role.bgInteractiveStrong, strokeWidth: 1.25, strokeDasharray: "2 2" },
  zone: { fill: role.bgInteractiveStrong, fillOpacity: 0.12 },
});
