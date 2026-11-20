import { Icon } from "@nyte-ai/ui/icon";
import { Row } from "@nyte-ai/ui/row";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { media, radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { KeyboardEvent, ReactElement } from "react";
import {
  formatPercent,
  formatTokens,
  formatUsd,
  formatUsdShort,
  groupDigits,
} from "../lib/format.ts";
import {
  focusRing,
  modelTint,
  Swatch,
  tintScope,
  tipSurface,
  useUsageFocus,
} from "./usage-parts.tsx";
import { usageStyles } from "./usage-settings.stylex.ts";
import type { ModelUsage, UsageBucket, UsageDerived, UsageSeries } from "./usage-view.ts";

const figure = { fontVariantNumeric: "tabular-nums" } as const;

const CHART_HEIGHT = 128;

const MIN_LAYER_PX = 2;

const LEADERS = 3;

const SPARK_BUCKETS = 30;

const chart = create({
  figure: { display: "flex", flexDirection: "column", gap: space.s2, margin: 0, minWidth: 0 },
  plot: {
    position: "relative",
    display: "flex",
    gap: space.s0_5,
    height: CHART_HEIGHT,
    borderRadius: radius.indicator,
  },
  column: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-end",
    flex: "1 1 0",
    minWidth: 0,
    outlineStyle: "dashed",
    outlineWidth: 1,
    outlineOffset: 1,
    outlineColor: "transparent",
  },
  columnActive: { outlineColor: role.strokeSecondary },
  dots: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    backgroundImage: `radial-gradient(circle, ${role.strokeTertiary} 0.75px, transparent 1px)`,
    backgroundPosition: "center bottom",
    backgroundSize: "100% 6px",
  },
  bar: {
    position: "relative",
    display: "flex",
    flexDirection: "column-reverse",
    gap: space.px,
    minHeight: 0,
  },
  layer: {
    display: "block",
    minHeight: 0,
    flexBasis: 0,
    backgroundColor: role.fillPrimary,
    transitionProperty: "background-color",
    transitionDuration: {
      default: motion.durationFast,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  layerOther: { backgroundColor: role.fillSecondary },
  layerLit: { backgroundColor: role.chartSeries },
  partial: {
    position: "absolute",
    insetInline: 0,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: role.strokeTertiary,
    borderBlockEndWidth: 0,
    pointerEvents: "none",
  },
  average: {
    position: "absolute",
    zIndex: 1,
    insetInline: 0,
    height: 0,
    borderBlockStartWidth: 1,
    borderBlockStartStyle: "dashed",
    borderBlockStartColor: role.strokeSecondary,
    pointerEvents: "none",
  },
  averageLabel: {
    ...figure,
    position: "absolute",
    insetInlineEnd: 0,
    insetBlockEnd: space.s1,
    paddingInline: space.s1,
    borderRadius: radius.indicator,
    backgroundColor: role.bgMuted,
    color: role.contentTertiary,
    whiteSpace: "nowrap",
  },
  axis: { position: "relative", height: space.s4 },
  tick: {
    ...figure,
    position: "absolute",
    insetBlockStart: 0,
    color: role.contentTertiary,
    whiteSpace: "nowrap",
  },
  tickActive: { color: role.contentPrimary, fontWeight: type.weightMedium },
});

const cards = create({
  grid: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(3, minmax(0, 1fr))",
      "@container usage (max-width: 560px)": "minmax(0, 1fr)",
    },
    gap: space.s2,
  },
  item: { display: "flex", minWidth: 0 },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.s1_5,
    width: "100%",
    minWidth: 0,
    paddingBlock: space.s2_5,
    "--_row-padding-inline": space.s3,
    overflow: "clip",
    borderRadius: radius.card,
    "--_row-fill": {
      default: role.bgMutedTranslucent,
      ":hover": { [media.hover]: role.fillTertiary },
    },
  },
  cardPinned: {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: space.s1_5,
    width: "100%",
    minWidth: 0,
    paddingBlock: space.s2_5,
    "--_row-padding-inline": space.s3,
    overflow: "clip",
    borderRadius: radius.card,
    "--_row-fill": role.fillSecondary,
  },
  watermark: {
    position: "absolute",
    zIndex: -1,
    insetInlineEnd: space.s4,
    insetBlockEnd: space.s6,
    color: role.fillSecondary,
    transform: "scale(3.5)",
    pointerEvents: "none",
  },
  watermarkLit: { color: role.fillPrimary },
  top: { display: "flex", alignItems: "center", gap: space.s1_5, minWidth: 0 },
  rank: { ...figure, color: role.contentTertiary },
  icon: { flexShrink: 0, color: role.contentSecondary },
  model: {
    minWidth: 0,
    color: role.contentPrimary,
    fontWeight: type.weightMedium,
    overflowWrap: "anywhere",
  },
  pin: { flexShrink: 0, color: role.contentPrimary },
  figures: { display: "flex", alignItems: "baseline", gap: space.s1_5 },
  amount: { ...figure, color: role.contentPrimary, fontWeight: type.weightMedium },
  share: { ...figure, color: role.contentTertiary },
  meta: { ...figure, color: role.contentTertiary, overflowWrap: "anywhere" },
  spark: {
    display: "flex",
    alignItems: "flex-end",
    gap: space.px,
    height: space.s4,
    marginBlockStart: space.s0_5,
  },
  sparkBar: { flex: "1 1 0", minHeight: 1, borderRadius: 1, backgroundColor: role.fillPrimary },
  sparkLit: { backgroundColor: role.chartSeries },
});

export function ModelColumns({ usage }: { readonly usage: UsageDerived }): ReactElement {
  const focus = useUsageFocus();
  const [active, setActive] = useState<number | undefined>(undefined);
  const buckets = usage.buckets;
  const peak = Math.max(...buckets.map((bucket) => bucket.total), 0);
  const top = peak === 0 ? 1 : peak * 1.08;
  const pointed = active === undefined ? undefined : buckets[active];
  const unit = usage.grain;
  const format = usage.measure === "cost" ? formatUsd : formatTokens;

  const step = (event: KeyboardEvent<HTMLDivElement>): void => {
    const last = buckets.length - 1;
    const current = active ?? last;

    const next =
      event.key === "ArrowLeft"
        ? Math.max(current - 1, 0)
        : event.key === "ArrowRight"
          ? Math.min(current + 1, last)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : undefined;

    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  return (
    <figure {...props(chart.figure)}>
      <div
        role="group"
        aria-roledescription="chart"
        aria-label={`${usage.measure === "cost" ? "Spend" : "Tokens"} per ${unit} by model. Use the arrow keys to read each ${unit}.`}
        tabIndex={0}
        onKeyDown={step}
        onFocus={() => setActive((current) => current ?? buckets.length - 1)}
        onBlur={() => setActive(undefined)}
        onPointerLeave={() => {
          setActive(undefined);
          focus.hover(undefined);
        }}
        {...props(chart.plot, focusRing)}
      >
        {usage.average > 0 && (
          <span
            aria-hidden="true"
            {...props(chart.average)}
            style={{ bottom: `${String((usage.average / top) * 100)}%` }}
          >
            <span {...props(text.xs, chart.averageLabel)}>
              avg{" "}
              {usage.measure === "cost"
                ? formatUsdShort(usage.average)
                : formatTokens(usage.average)}
              /{unit}
            </span>
          </span>
        )}
        {buckets.map((bucket, index) => (
          <Column
            key={bucket.key}
            bucket={bucket}
            top={top}
            average={usage.average}
            active={index === active}
            onEnter={() => setActive(index)}
            series={usage.series}
          />
        ))}
        {pointed !== undefined && active !== undefined && (
          <ColumnTip
            bucket={pointed}
            index={active}
            count={buckets.length}
            series={usage.series}
            format={format}
          />
        )}
        <span aria-live="polite" {...props(srOnly)}>
          {pointed === undefined ? "" : `${pointed.label}: ${format(pointed.total)}`}
        </span>
      </div>
      <div aria-hidden="true" {...props(chart.axis)}>
        {buckets.map((bucket, index) =>
          bucket.tick === undefined ? null : (
            <span
              key={bucket.key}
              {...props(text.xs, chart.tick, index === active && chart.tickActive)}
              style={{ left: `${String((index / buckets.length) * 100)}%` }}
            >
              {bucket.tick}
            </span>
          ),
        )}
      </div>
    </figure>
  );
}

function Column({
  bucket,
  top,
  average,
  active,
  onEnter,
  series,
}: {
  readonly bucket: UsageBucket;
  readonly top: number;
  readonly average: number;
  readonly active: boolean;
  readonly onEnter: () => void;
  readonly series: readonly UsageSeries[];
}): ReactElement {
  const focus = useUsageFocus();
  const height = (bucket.total / top) * 100;
  const pixels = (value: number): number => (value / top) * CHART_HEIGHT;

  return (
    <div onPointerEnter={onEnter} {...props(chart.column, active && chart.columnActive)}>
      <span
        aria-hidden="true"
        {...props(chart.dots)}
        style={{
          maskImage: `linear-gradient(to top, transparent ${String(height)}%, black ${String(height)}%)`,
        }}
      />
      {bucket.partial && average > bucket.total && (
        <span
          aria-hidden="true"
          {...props(chart.partial)}
          style={{
            bottom: `${String(height)}%`,
            height: `${String(((average - bucket.total) / top) * 100)}%`,
          }}
        />
      )}
      <span aria-hidden="true" {...props(chart.bar)} style={{ height: `${String(height)}%` }}>
        {bucket.values.map((value, index) => {
          const layer = series[index];

          if (layer === undefined || pixels(value) < MIN_LAYER_PX) return null;
          const other = layer.rank === undefined;
          const tint = other ? undefined : modelTint(focus, layer.key);

          return (
            <span
              key={layer.key}
              onPointerEnter={() => focus.hover(other ? undefined : layer.key)}
              {...props(
                tintScope(tint),
                chart.layer,
                other && chart.layerOther,
                tint !== undefined && chart.layerLit,
              )}
              style={{ flexGrow: value }}
            />
          );
        })}
      </span>
    </div>
  );
}

function ColumnTip({
  bucket,
  index,
  count,
  series,
  format,
}: {
  readonly bucket: UsageBucket;
  readonly index: number;
  readonly count: number;
  readonly series: readonly UsageSeries[];
  readonly format: (value: number) => string;
}): ReactElement {
  const focus = useUsageFocus();

  const rows = series
    .map((layer, layerIndex) => ({ layer, value: bucket.values[layerIndex] ?? 0 }))
    .filter((row) => row.value > 0);

  return (
    <div
      aria-hidden="true"
      {...props(text.xs, tipSurface)}
      style={
        index / count < 0.6
          ? { left: `calc(${String(((index + 1) / count) * 100)}% + 8px)`, top: 0 }
          : { right: `calc(${String((1 - index / count) * 100)}% + 8px)`, top: 0 }
      }
    >
      <span {...props(usageStyles.tipHead)}>
        <span {...props(usageStyles.tipTitle)}>{bucket.label}</span>
        {bucket.partial && <span {...props(usageStyles.tipQuiet)}>so far</span>}
      </span>
      <span {...props(usageStyles.tipQuiet)}>{format(bucket.total)} total</span>
      {rows.length > 0 && <span {...props(usageStyles.tipRule)} />}
      {rows.map(({ layer, value }) => {
        const tint = layer.rank === undefined ? undefined : modelTint(focus, layer.key);

        return (
          <span
            key={layer.key}
            {...props(usageStyles.tipRow, tint !== undefined && usageStyles.tipRowActive)}
          >
            <span {...props(usageStyles.tipKey)}>
              <Swatch tint={tint} />
              <span {...props(usageStyles.tipName)}>{layer.label}</span>
            </span>
            <span>{format(value)}</span>
          </span>
        );
      })}
      {rows.length === 0 && <span {...props(usageStyles.tipQuiet)}>No usage</span>}
    </div>
  );
}

export function TopModels({ usage }: { readonly usage: UsageDerived }): ReactElement {
  return (
    <div role="list" aria-label="Top models" {...props(cards.grid)}>
      {usage.models.slice(0, LEADERS).map((model, rank) => (
        <TopModel key={model.key} model={model} rank={rank} usage={usage} />
      ))}
    </div>
  );
}

function TopModel({
  model,
  rank,
  usage,
}: {
  readonly model: ModelUsage;
  readonly rank: number;
  readonly usage: UsageDerived;
}): ReactElement {
  const focus = useUsageFocus();
  const tint = modelTint(focus, model.key);
  const pinned = focus.pinned === model.key;
  const recent = model.series.slice(-SPARK_BUCKETS);
  const peak = Math.max(...recent, 0);
  const amount = usage.measure === "cost" ? formatUsd(model.amount) : formatTokens(model.amount);

  const cache =
    model.cache.ratio === undefined ? "no cache" : `${formatPercent(model.cache.ratio)} cache`;

  const meta = `${groupDigits(String(model.chats))} chats · ${cache}`;

  return (
    <div role="listitem" {...props(cards.item)}>
      <Row
        variant="nav"
        selected={pinned}
        aria-pressed={pinned}
        aria-label={`${model.model} by ${model.vendor}, ${amount}, ${formatPercent(model.share)} of the total, ${meta}`}
        onPointerEnter={() => focus.hover(model.key)}
        onPointerLeave={() => focus.hover(undefined)}
        onFocus={() => focus.hover(model.key)}
        onBlur={() => focus.hover(undefined)}
        onClick={() => focus.toggle(model.key)}
        xstyle={pinned ? cards.cardPinned : cards.card}
      >
        <span
          aria-hidden="true"
          {...props(tintScope(tint), cards.watermark, tint !== undefined && cards.watermarkLit)}
        >
          <Icon name={model.icon} size="lg" />
        </span>
        <span {...props(text.sm, cards.top)}>
          <span {...props(cards.rank)}>{String(rank + 1).padStart(2, "0")}</span>
          <Icon name={model.icon} size="sm" {...props(cards.icon)} />
          <span {...props(cards.model)}>{model.model}</span>
          {pinned && <Icon name="pin" size="xs" {...props(cards.pin)} />}
        </span>
        <span {...props(cards.figures)}>
          <span {...props(text.lg, cards.amount)}>{amount}</span>
          <span {...props(text.sm, cards.share)}>{formatPercent(model.share)}</span>
        </span>
        <span {...props(text.xs, cards.meta)}>{meta}</span>
        <span aria-hidden="true" {...props(cards.spark)}>
          {recent.map((value, index) => (
            <span
              key={index}
              {...props(tintScope(tint), cards.sparkBar, tint !== undefined && cards.sparkLit)}
              style={{ height: `${String(peak === 0 ? 0 : (value / peak) * 100)}%` }}
            />
          ))}
        </span>
      </Row>
    </div>
  );
}
