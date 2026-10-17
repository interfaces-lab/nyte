/** The Spend view: cost and token tickers above the stacked chart and its breakdown. */
import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { KIND_TINT, StackedChart, hitRate, readKind, readTotal, type Metric } from "./charts";
import {
  GROUPINGS,
  TOKEN_KINDS,
  TOKEN_LABELS,
  bucketTotal,
  rows as groupRows,
  seriesTotal,
  slicePeriod,
  sumKinds,
  type Grouping,
  type Period,
  type Tally,
  type TokenKind,
} from "./fixtures";
import { bucketLabel, count, pct, tokens, usd } from "./format";
import { Breakdown } from "./breakdown";
import { Cell, describeChange, judgeTone } from "./cells";
import { styles } from "./page.stylex";

export function SpendView({
  metric,
  period,
  selected,
  onSelect,
}: {
  readonly metric: Metric;
  readonly period: Period;
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
}): ReactElement {
  const [grouping, setGrouping] = useState<Grouping>("model");
  const [emphasis, setEmphasis] = useState<TokenKind | null>(null);
  const { current, previous } = slicePeriod(period);
  const table = groupRows(grouping, current);
  const tableBefore = groupRows(grouping, previous);
  const focus = table.find((row) => row.id === selected);
  const focusBefore = tableBefore.find((row) => row.id === selected);
  const series = focus?.series ?? current.map(bucketTotal);
  const seriesBefore = focusBefore?.series ?? previous.map(bucketTotal);
  const now = seriesTotal(series);
  const before = seriesTotal(seriesBefore);
  const perUnit = period.unit === "hour" ? "/HR" : "/DAY";

  return (
    <>
      <div {...props(styles.ticker)}>
        {metric === "cost" ? (
          <CostTicker now={now} before={before} series={series} period={period} perUnit={perUnit} />
        ) : (
          <TokenTicker now={now} before={before} />
        )}
      </div>

      <section aria-label="Chart" {...props(styles.panel)}>
        <div {...props(styles.panelBar)}>
          <span {...props(styles.panelTitle)}>{metric === "cost" ? "Cost" : "Tokens"} by kind</span>
          {focus !== undefined && (
            <button type="button" {...props(styles.chip)} onClick={() => onSelect(null)}>
              {focus.id}
              <Kbd keys={["Esc"]} plain />
            </button>
          )}
          <span {...props(styles.grow)} />
          {}
          <span role="group" aria-label="Kinds" {...props(styles.keys)}>
            {TOKEN_KINDS.toReversed().map((kind) => (
              <span
                key={kind}
                {...props(styles.key)}
                onPointerEnter={() => setEmphasis(kind)}
                onPointerLeave={() => setEmphasis(null)}
              >
                <span {...props(surfaceTheme[KIND_TINT[kind]], styles.swatch)} />
                {TOKEN_LABELS[kind]}
                <span {...props(styles.keyValue)}>
                  {pct(
                    readKind(now, metric, kind) / Math.max(readTotal(now, metric), Number.EPSILON),
                  )}
                </span>
              </span>
            ))}
            <span {...props(styles.key)}>
              <span {...props(styles.dash)} />
              Prev
            </span>
            {metric === "tokens" && (
              <span {...props(styles.key)}>
                <span {...props(styles.solid)} />
                Hit
              </span>
            )}
          </span>
        </div>
        <StackedChart
          current={series}
          previous={seriesBefore}
          starts={current.map((b) => b.start)}
          unit={period.unit}
          metric={metric}
          emphasis={emphasis}
        />
      </section>

      <section aria-label="Breakdown" {...props(styles.panel)}>
        <div {...props(styles.panelBar)}>
          <span {...props(styles.panelTitle)}>Breakdown</span>
          <ToggleGroup
            aria-label="Group by"
            value={[grouping]}
            onValueChange={(values) => {
              const next = GROUPINGS.find((item) => item.key === values[0]);

              if (next !== undefined) {
                setGrouping(next.key);
                onSelect(null);
              }
            }}
          >
            {GROUPINGS.map((item) => (
              <Toggle key={item.key} value={item.key} size="sm">
                {item.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <span {...props(styles.grow)} />
          <span {...props(styles.stamp)}>{count(table.length)} rows</span>
        </div>
        <Breakdown
          rows={table}
          before={tableBefore}
          metric={metric}
          selected={selected}
          onSelect={onSelect}
        />
      </section>
    </>
  );
}

function CostTicker({
  now,
  before,
  series,
  period,
  perUnit,
}: {
  readonly now: Tally;
  readonly before: Tally;
  readonly series: readonly Tally[];
  readonly period: Period;
  readonly perUnit: string;
}): ReactElement {
  const cost = sumKinds(now.cost);
  const costBefore = sumKinds(before.cost);
  const mtok = sumKinds(now.tokens) / 1e6;
  const mtokBefore = sumKinds(before.tokens) / 1e6;
  const perDay = period.unit === "hour" ? cost : cost / period.buckets;

  const peak = series.reduce(
    (best, tally, index) =>
      sumKinds(tally.cost) > sumKinds(series[best]?.cost ?? tally.cost) ? index : best,
    0,
  );

  const starts = slicePeriod(period).current.map((b) => b.start);

  return (
    <>
      <Cell
        label="Cost"
        value={usd(cost)}
        {...describeChange({ current: cost, previous: costBefore })}
      />
      <Cell
        label={`Avg${perUnit}`}
        value={usd(cost / series.length)}
        {...describeChange({ current: cost / series.length, previous: costBefore / series.length })}
      />
      <Cell label="Run rate 30D" value={usd(perDay * 30)} sub={`${usd(perDay)}/day`} />
      <Cell
        label="Peak"
        value={usd(sumKinds(series[peak]?.cost ?? now.cost))}
        sub={bucketLabel(starts[peak] ?? 0, period.unit)}
      />
      <Cell
        label="$/Mtok"
        value={usd(cost / Math.max(mtok, Number.EPSILON))}
        {...describeChange({
          current: cost / Math.max(mtok, Number.EPSILON),
          previous: costBefore / Math.max(mtokBefore, Number.EPSILON),
        })}
      />
      <Cell
        label="Cache saved"
        value={usd(now.saved)}
        sub={`${pct(now.saved / (cost + now.saved))} of gross`}
        tone="good"
      />
      <Cell label="Output" value={pct(now.cost.output / cost, 1)} sub={usd(now.cost.output)} />
      <Cell
        label="Turns"
        value={count(now.turns)}
        {...describeChange({ current: now.turns, previous: before.turns, upIsGood: true })}
      />
      <Cell
        label="$/Turn"
        value={usd(cost / Math.max(now.turns, 1))}
        {...describeChange({
          current: cost / Math.max(now.turns, 1),
          previous: costBefore / Math.max(before.turns, 1),
        })}
      />
    </>
  );
}

function TokenTicker({
  now,
  before,
}: {
  readonly now: Tally;
  readonly before: Tally;
}): ReactElement {
  const total = sumKinds(now.tokens);
  const hit = hitRate(now);
  const hitBefore = hitRate(before);

  return (
    <>
      <Cell
        label="Tokens"
        value={tokens(total)}
        {...describeChange({ current: total, previous: sumKinds(before.tokens), upIsGood: true })}
      />
      {TOKEN_KINDS.map((kind) => (
        <Cell
          key={kind}
          label={TOKEN_LABELS[kind]}
          value={tokens(now.tokens[kind])}
          {...describeChange({
            current: now.tokens[kind],
            previous: before.tokens[kind],
            upIsGood: kind === "cacheRead",
          })}
        />
      ))}
      <Cell
        label="Hit rate"
        value={pct(hit, 1)}
        sub={`${hit >= hitBefore ? "+" : "−"}${(Math.abs(hit - hitBefore) * 100).toFixed(1)} pts`}
        tone={judgeTone(Math.abs(hit - hitBefore) < 0.0005 ? 0 : hit > hitBefore ? 1 : -1, true)}
      />
      <Cell label="Tok/Turn" value={tokens(total / Math.max(now.turns, 1))} />
      <Cell
        label="Out:In"
        value={`1:${(now.tokens.input / Math.max(now.tokens.output, 1)).toFixed(1)}`}
      />
    </>
  );
}
