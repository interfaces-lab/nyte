import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { intent } from "@nyte-ai/ui/surface-theme";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactElement } from "react";
import {
  formatPercent,
  formatTokens,
  formatUsd,
  formatUsdPrecise,
  formatUsdShort,
  groupDigits,
} from "../lib/format.ts";
import { Bone, focusRing, tipSurface } from "./usage-parts.tsx";
import { usageStyles } from "./usage-settings.stylex.ts";
import { dayLabel, promptTokens, type UsageDerived } from "./usage-view.ts";

const figure = { fontVariantNumeric: "tabular-nums" } as const;

const HEIGHT = 56;

const WIDTH = 1000;

const styles = create({
  card: { flex: "1 1 12rem", gap: space.s2 },
  head: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.s2,
  },
  label: { color: role.contentSecondary },
  change: { ...figure, color: role.contentAccent, whiteSpace: "nowrap" },
  amount: {
    ...figure,
    margin: 0,
    color: role.contentPrimary,
    fontSize: type.font2xl,
    fontWeight: type.weightSemibold,
    lineHeight: type.leading2xl,
    letterSpacing: "-0.01em",
  },
  pace: { ...figure, margin: 0, color: role.contentTertiary },
  plot: {
    position: "relative",
    height: HEIGHT,
    marginBlockStart: "auto",
    minWidth: 0,
    touchAction: "pan-y",
  },
  svg: { position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" },
  area: { fill: role.fillTertiary },
  line: {
    fill: "none",
    stroke: role.contentSecondary,
    strokeWidth: 1.5,
    strokeLinejoin: "round",
  },
  forecast: {
    fill: "none",
    stroke: role.contentTertiary,
    strokeWidth: 1.5,
    strokeDasharray: "3 3",
  },
  marker: {
    position: "absolute",
    width: 6,
    height: 6,
    borderRadius: radius.pill,
    transform: "translate(-50%, 50%)",
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1.5px ${role.contentSecondary}`,
    pointerEvents: "none",
  },
  markerForecast: { boxShadow: `0 0 0 1.5px ${role.contentTertiary}` },
  cursor: {
    position: "absolute",
    insetBlock: 0,
    width: 1,
    backgroundColor: role.strokeTertiary,
    pointerEvents: "none",
  },
  tip: { insetBlockEnd: `calc(100% + ${space.s2})` },
  stats: {
    display: "grid",
    gridTemplateColumns: {
      default: "repeat(4, minmax(0, 1fr))",
      "@container usage (max-width: 560px)": "repeat(2, minmax(0, 1fr))",
    },
    gap: space.s2,
    margin: 0,
  },
  stat: { gap: space.s0_5, paddingBlock: space.s2_5, paddingInline: space.s3 },
  statLabel: { color: role.contentTertiary },
  statValue: { ...figure, margin: 0, color: role.contentPrimary, fontWeight: type.weightMedium },
  statMeta: { ...figure, margin: 0, color: role.contentTertiary },
});

export function SpendCard({
  usage,
  rangeLabel,
  priorLabel,
}: {
  readonly usage: UsageDerived;
  readonly rangeLabel: string;
  readonly priorLabel: string;
}): ReactElement {
  const [cursor, setCursor] = useState<number | undefined>(undefined);

  const format =
    usage.measure === "cost" ? formatUsd : (value: number) => `${formatTokens(value)} tokens`;

  const short = usage.measure === "cost" ? formatUsdShort : formatTokens;
  const pace = usage.pace;
  const last = pace.points.at(-1);
  const top = Math.max(pace.forecast?.value ?? 0, last?.value ?? 0, 1) * 1.08;
  const span = Math.max(pace.days.length - 1, 1);
  const x = (index: number): number => (index / span) * WIDTH;
  const y = (value: number): number => HEIGHT - (value / top) * HEIGHT;

  const line = pace.points
    .map(
      (point, index) => `${index === 0 ? "M" : "L"}${String(x(index))},${String(y(point.value))}`,
    )
    .join(" ");

  const lastIndex = pace.points.length - 1;
  const pointed = cursor === undefined ? undefined : pace.points[cursor];
  const thatDay = (index: number, value: number) => value - (pace.points[index - 1]?.value ?? 0);

  const step = (event: KeyboardEvent<HTMLDivElement>): void => {
    const current = cursor ?? lastIndex;

    const next =
      event.key === "ArrowLeft"
        ? Math.max(current - 1, 0)
        : event.key === "ArrowRight"
          ? Math.min(current + 1, lastIndex)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? lastIndex
              : undefined;

    if (next === undefined) return;
    event.preventDefault();
    setCursor(next);
  };

  const move = (event: PointerEvent<HTMLDivElement>): void => {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.round(((event.clientX - box.left) / box.width) * span);
    setCursor(Math.min(Math.max(index, 0), lastIndex));
  };

  return (
    <section aria-label="Spend" {...props(usageStyles.card, styles.card)}>
      <div {...props(text.sm, styles.head)}>
        <span {...props(styles.label)}>
          {usage.measure === "cost" ? "Spent" : "Used"}, {rangeLabel}
        </span>
        {usage.change !== undefined && (
          <span {...props(usage.change > 0 ? intent.warning : intent.success, styles.change)}>
            {usage.change > 0 ? "↑" : "↓"} {formatPercent(Math.abs(usage.change))}
            <span {...props(srOnly)}> vs {priorLabel}</span>
          </span>
        )}
      </div>
      <p {...props(styles.amount)}>
        {usage.measure === "cost"
          ? formatUsd(usage.amount)
          : `${formatTokens(usage.amount)} tokens`}
      </p>
      {pace.forecast !== undefined && (
        <p {...props(text.sm, styles.pace)}>
          On pace for {short(pace.forecast.value)} by {dayLabel(pace.forecast.day)}
        </p>
      )}
      <div
        role="group"
        aria-roledescription="chart"
        aria-label={`Running total over ${rangeLabel}. Use the arrow keys to read each day.`}
        tabIndex={0}
        onKeyDown={step}
        onFocus={() => setCursor((current) => current ?? lastIndex)}
        onBlur={() => setCursor(undefined)}
        onPointerMove={move}
        onPointerLeave={() => setCursor(undefined)}
        {...props(styles.plot, focusRing)}
      >
        <svg
          viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
          preserveAspectRatio="none"
          {...props(styles.svg)}
        >
          {last !== undefined && (
            <path
              d={`${line} L${String(x(lastIndex))},${String(HEIGHT)} L0,${String(HEIGHT)} Z`}
              {...props(styles.area)}
            />
          )}
          <path d={line} vectorEffect="non-scaling-stroke" {...props(styles.line)} />
          {pace.forecast !== undefined && last !== undefined && (
            <path
              d={`M${String(x(lastIndex))},${String(y(last.value))} L${String(WIDTH)},${String(y(pace.forecast.value))}`}
              vectorEffect="non-scaling-stroke"
              {...props(styles.forecast)}
            />
          )}
        </svg>
        {last !== undefined && (
          <span
            {...props(styles.marker)}
            style={{
              left: `${String((lastIndex / span) * 100)}%`,
              bottom: `${String((last.value / top) * 100)}%`,
            }}
          />
        )}
        {pace.forecast !== undefined && (
          <span
            {...props(styles.marker, styles.markerForecast)}
            style={{ left: "100%", bottom: `${String((pace.forecast.value / top) * 100)}%` }}
          />
        )}
        {pointed !== undefined && cursor !== undefined && (
          <>
            <span
              aria-hidden="true"
              {...props(styles.cursor)}
              style={{ left: `${String((cursor / span) * 100)}%` }}
            />
            <div
              aria-hidden="true"
              {...props(text.xs, tipSurface, styles.tip)}
              style={
                cursor / span < 0.5
                  ? { left: `${String((cursor / span) * 100)}%` }
                  : { right: `${String((1 - cursor / span) * 100)}%` }
              }
            >
              <span {...props(usageStyles.tipTitle)}>{dayLabel(pointed.day)}</span>
              <span {...props(usageStyles.tipRow)}>
                <span>Running total</span>
                <span {...props(usageStyles.value)}>{format(pointed.value)}</span>
              </span>
              <span {...props(usageStyles.tipRow)}>
                <span>That day</span>
                <span {...props(usageStyles.value)}>{format(thatDay(cursor, pointed.value))}</span>
              </span>
            </div>
          </>
        )}
        <span aria-live="polite" {...props(srOnly)}>
          {pointed === undefined || cursor === undefined
            ? ""
            : `${dayLabel(pointed.day)}: ${format(pointed.value)} so far, ${format(thatDay(cursor, pointed.value))} that day`}
        </span>
      </div>
    </section>
  );
}

export function SpendBone(): ReactElement {
  return (
    <div aria-hidden="true" {...props(usageStyles.card, styles.card)}>
      <Bone width={96} height={12} />
      <Bone width={128} height={24} />
      <Bone width="100%" height={HEIGHT} />
    </div>
  );
}

export function UsageFigures({ usage }: { readonly usage: UsageDerived }): ReactElement {
  const prompt = promptTokens(usage.totals);

  const items: readonly (readonly [string, string, string])[] = [
    [
      "Chats",
      groupDigits(String(usage.chats)),
      usage.priced && usage.chats > 0
        ? `${formatUsdPrecise(usage.totals.cost / usage.chats)} each`
        : "",
    ],
    ["Tokens", formatTokens(usage.totals.tokens), `${formatTokens(usage.totals.output)} output`],
    [
      "Cache hit",
      prompt === 0 ? "—" : formatPercent(usage.totals.cacheRead / prompt),
      `${formatTokens(usage.totals.cacheRead)} read`,
    ],
    usage.priced
      ? ["Saved by cache", formatUsd(usage.totals.cacheSavings), "vs list input price"]
      : ["Models", String(usage.models.length), "used in range"],
  ];

  return (
    <dl {...props(styles.stats)}>
      {items.map(([label, value, meta]) => (
        <div key={label} {...props(usageStyles.card, styles.stat)}>
          <dt {...props(text.sm, styles.statLabel)}>{label}</dt>
          <dd {...props(text.lg, styles.statValue)}>{value}</dd>
          {meta !== "" && <dd {...props(text.xs, styles.statMeta)}>{meta}</dd>}
        </div>
      ))}
    </dl>
  );
}
