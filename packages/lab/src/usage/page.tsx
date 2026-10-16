/**
 * Settings › Usage drafted as a terminal: one dense surface of figures the
 * reader scans and compares, no sentences explaining them. Cost, Tokens and
 * Limits share a ticker strip, a chart and a table; the table ranks by cost and
 * carries the running share, so the few rows that make most of the spend stand
 * out without a chart of their own. Fixture data only; see `fixtures.ts`.
 *
 * Keys: C, T, L switch views; Ctrl or Cmd + Shift + 1-4 pick the period;
 * Escape clears the row filter.
 */
import { create, props } from "@stylexjs/stylex";
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Kbd } from "@nyte-ai/ui/kbd";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { radius } from "@nyte-ai/ui/styles/schema.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import {
  KIND_TINT,
  LimitTrace,
  Sparkline,
  StackedChart,
  TRACE_WIDTH,
  hitRate,
  readKind,
  readTotal,
  type Metric,
} from "./charts";
import {
  ACCOUNTS,
  GROUPINGS,
  NOW_AT,
  PERIODS,
  TOKEN_KINDS,
  TOKEN_LABELS,
  bucketTotal,
  rows as groupRows,
  seriesTotal,
  slicePeriod,
  sumOf,
  type Account,
  type Grouping,
  type Period,
  type Row,
  type Tally,
  type TokenKind,
} from "./fixtures";
import { bucketLabel, count, delta, duration, pct, project, tokens, usd } from "./format";
import { dataFont, useFamily, widest } from "./measure";

const VIEWS = [
  { key: "cost", label: "Cost", hotkey: "c" },
  { key: "tokens", label: "Tokens", hotkey: "t" },
  { key: "limits", label: "Limits", hotkey: "l" },
] as const;

type View = (typeof VIEWS)[number]["key"];

const SCHEMES = [
  ["system", "Auto", "light dark"],
  ["light", "Light", "light"],
  ["dark", "Dark", "dark"],
] as const;

type Scheme = (typeof SCHEMES)[number][0];

/** Where cumulative cost crosses this, the rest of the table is the tail. */
const PARETO_CUT = 0.8;

const asOf = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
}).format(NOW_AT);

export function UsagePage(): ReactElement {
  const [scheme, setScheme] = useState<Scheme>("system");
  const [view, setView] = useState<View>("cost");
  const [period, setPeriod] = useState<Period>(PERIODS[1]);
  const [selected, setSelected] = useState<string | null>(null);

  // On the document, so portalled tooltips follow the scheme too.
  useEffect(() => {
    document.documentElement.style.colorScheme =
      SCHEMES.find(([name]) => name === scheme)?.[2] ?? "light dark";

    return () => {
      document.documentElement.style.colorScheme = "";
    };
  }, [scheme]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target;

      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest("input, textarea, select") !== null)
      )
        return;

      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        const next = PERIODS[Number(event.code.replace("Digit", "")) - 1];

        if (next === undefined) return;

        event.preventDefault();
        setPeriod(next);

        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === "Escape") setSelected(null);

      const next = VIEWS.find((item) => item.hotkey === event.key.toLowerCase());

      if (next !== undefined) setView(next.key);
    };

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <main {...props(styles.page)}>
      <div {...props(styles.frame)}>
        <header {...props(styles.bar)}>
          <h1 {...props(styles.title)}>Usage</h1>
          <Tabs.Root
            variant="segmented"
            value={view}
            onValueChange={(value) => {
              const next = VIEWS.find((item) => item.key === value);

              if (next !== undefined) setView(next.key);
            }}
          >
            <Tabs.List aria-label="View">
              {VIEWS.map((item) => (
                <Tabs.Tab key={item.key} value={item.key}>
                  {item.label}
                  <Kbd keys={[item.hotkey.toUpperCase()]} plain />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.Root>
          <span {...props(styles.grow)} />
          {view !== "limits" && (
            <ToggleGroup
              aria-label="Period"
              value={[period.key]}
              onValueChange={(values) => {
                const next = PERIODS.find((item) => item.key === values[0]);

                if (next !== undefined) setPeriod(next);
              }}
            >
              {PERIODS.map((item) => (
                <Toggle key={item.key} value={item.key} size="sm">
                  {item.label}
                </Toggle>
              ))}
            </ToggleGroup>
          )}
          <ToggleGroup
            aria-label="Appearance"
            value={[scheme]}
            onValueChange={(values) => {
              const next = SCHEMES.find(([name]) => name === values[0]);

              if (next !== undefined) setScheme(next[0]);
            }}
          >
            {SCHEMES.map(([name, label]) => (
              <Toggle key={name} value={name} size="sm">
                {label}
              </Toggle>
            ))}
          </ToggleGroup>
          <span {...props(styles.stamp)}>{asOf} UTC</span>
        </header>

        {view === "limits" ? (
          <LimitsView />
        ) : (
          <SpendView metric={view} period={period} selected={selected} onSelect={setSelected} />
        )}
      </div>
    </main>
  );
}

type Tone = "neutral" | "good" | "bad";

const TONE_SCOPE = { neutral: null, good: intent.success, bad: intent.danger } as const;

function Cell({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: string;
  readonly sub?: string;
  readonly tone?: Tone;
}): ReactElement {
  return (
    <div {...props(styles.cell)}>
      <span {...props(styles.cellLabel)}>{label}</span>
      <span {...props(styles.cellValue)}>{value}</span>
      <span {...props(TONE_SCOPE[tone], styles.cellSub, tone !== "neutral" && styles.toned)}>
        {sub ?? "\u00a0"}
      </span>
    </div>
  );
}

/** Rising cost reads bad, rising cache hits read good; flat reads neutral. */
function toneOf(sign: -1 | 0 | 1, upIsGood: boolean): Tone {
  if (sign === 0) return "neutral";

  return sign > 0 === upIsGood ? "good" : "bad";
}

function changeOf({
  current,
  previous,
  upIsGood = false,
}: {
  readonly current: number;
  readonly previous: number;
  readonly upIsGood?: boolean;
}) {
  const change = delta(current, previous);

  return { sub: change.text, tone: toneOf(change.sign, upIsGood) };
}

function SpendView({
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
          {/* Keys sit edge to edge and pad themselves, so the pointer never falls between two. */}
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
  const cost = sumOf(now.cost);
  const costBefore = sumOf(before.cost);
  const mtok = sumOf(now.tokens) / 1e6;
  const mtokBefore = sumOf(before.tokens) / 1e6;
  const perDay = period.unit === "hour" ? cost : cost / period.buckets;

  const peak = series.reduce(
    (best, tally, index) =>
      sumOf(tally.cost) > sumOf(series[best]?.cost ?? tally.cost) ? index : best,
    0,
  );

  const starts = slicePeriod(period).current.map((b) => b.start);

  return (
    <>
      <Cell label="Cost" value={usd(cost)} {...changeOf({ current: cost, previous: costBefore })} />
      <Cell
        label={`Avg${perUnit}`}
        value={usd(cost / series.length)}
        {...changeOf({ current: cost / series.length, previous: costBefore / series.length })}
      />
      <Cell label="Run rate 30D" value={usd(perDay * 30)} sub={`${usd(perDay)}/day`} />
      <Cell
        label="Peak"
        value={usd(sumOf(series[peak]?.cost ?? now.cost))}
        sub={bucketLabel(starts[peak] ?? 0, period.unit)}
      />
      <Cell
        label="$/Mtok"
        value={usd(cost / Math.max(mtok, Number.EPSILON))}
        {...changeOf({
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
        {...changeOf({ current: now.turns, previous: before.turns, upIsGood: true })}
      />
      <Cell
        label="$/Turn"
        value={usd(cost / Math.max(now.turns, 1))}
        {...changeOf({
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
  const total = sumOf(now.tokens);
  const hit = hitRate(now);
  const hitBefore = hitRate(before);

  return (
    <>
      <Cell
        label="Tokens"
        value={tokens(total)}
        {...changeOf({ current: total, previous: sumOf(before.tokens), upIsGood: true })}
      />
      {TOKEN_KINDS.map((kind) => (
        <Cell
          key={kind}
          label={TOKEN_LABELS[kind]}
          value={tokens(now.tokens[kind])}
          {...changeOf({
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
        tone={toneOf(Math.abs(hit - hitBefore) < 0.0005 ? 0 : hit > hitBefore ? 1 : -1, true)}
      />
      <Cell label="Tok/Turn" value={tokens(total / Math.max(now.turns, 1))} />
      <Cell
        label="Out:In"
        value={`1:${(now.tokens.input / Math.max(now.tokens.output, 1)).toFixed(1)}`}
      />
    </>
  );
}

type SortKey = "rank" | "value" | "delta" | "tokens" | "hit" | "rate" | "turns";

interface Line {
  readonly row: Row;
  readonly rank: number;
  readonly tally: Tally;
  readonly value: number;
  readonly change: ReturnType<typeof delta>;
  readonly changeRaw: number;
  readonly share: number;
  readonly cumulative: number;
  readonly rate: number;
}

const COLUMNS = [
  { key: "rank", align: "end" },
  { key: "name", align: "start" },
  { key: "value", align: "end" },
  { key: "delta", align: "end" },
  { key: "share", align: "end" },
  { key: "cum", align: "start" },
  { key: "tokens", align: "end" },
  { key: "hit", align: "end" },
  { key: "rate", align: "end" },
  { key: "turns", align: "end" },
  { key: "trend", align: "start" },
] as const;

type ColumnKey = (typeof COLUMNS)[number]["key"];

const SORTABLE: Partial<Record<ColumnKey, SortKey>> = {
  rank: "rank",
  value: "value",
  delta: "delta",
  tokens: "tokens",
  hit: "hit",
  rate: "rate",
  turns: "turns",
};

/** The width a cumulative bar is drawn in, beside its figure. */
const CUM_BAR = 56;

function Breakdown({
  rows,
  before,
  metric,
  selected,
  onSelect,
}: {
  readonly rows: readonly Row[];
  readonly before: readonly Row[];
  readonly metric: Metric;
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
}): ReactElement {
  const [node, setNode] = useState<HTMLTableElement | null>(null);
  const family = useFamily(node);

  const [sort, setSort] = useState<{ readonly key: SortKey; readonly descending: boolean }>({
    key: "rank",
    descending: false,
  });

  const totals = rows.map((row) => seriesTotal(row.series));
  const grand = totals.reduce((sum, tally) => sum + readTotal(tally, metric), 0);

  const ranked = rows
    .map((row, index) => ({ row, tally: totals[index] ?? seriesTotal([]) }))
    .toSorted((a, b) => readTotal(b.tally, metric) - readTotal(a.tally, metric));

  const lines: Line[] = ranked.reduce<Line[]>((built, { row, tally }, rank) => {
    const value = readTotal(tally, metric);

    const previous = readTotal(
      seriesTotal(before.find((item) => item.id === row.id)?.series ?? []),
      metric,
    );

    const share = grand === 0 ? 0 : value / grand;

    return [
      ...built,
      {
        row,
        rank,
        tally,
        value,
        change: delta(value, previous),
        changeRaw: previous === 0 ? 0 : (value - previous) / previous,
        share,
        cumulative: (built.at(-1)?.cumulative ?? 0) + share,
        rate: sumOf(tally.cost) / Math.max(sumOf(tally.tokens) / 1e6, Number.EPSILON),
      },
    ];
  }, []);

  const cut = lines.findIndex((line) => line.cumulative >= PARETO_CUT - 1e-9);

  const sortValue = (line: Line): number => {
    switch (sort.key) {
      case "rank":
        return line.rank;
      case "value":
        return line.value;
      case "delta":
        return line.changeRaw;
      case "tokens":
        return metric === "cost" ? sumOf(line.tally.tokens) : sumOf(line.tally.cost);
      case "hit":
        return hitRate(line.tally);
      case "rate":
        return line.rate;
      case "turns":
        return line.tally.turns;
      default: {
        const exhaustive: never = sort.key;

        return exhaustive;
      }
    }
  };

  const ordered = lines.toSorted((a, b) =>
    sort.descending ? sortValue(b) - sortValue(a) : sortValue(a) - sortValue(b),
  );

  const valueLabel = metric === "cost" ? "Cost" : "Tokens";
  const otherLabel = metric === "cost" ? "Tokens" : "Cost";

  const cells = (line: Line): Readonly<Record<ColumnKey, string>> => ({
    rank: String(line.rank + 1),
    name: line.row.id,
    value: metric === "cost" ? usd(line.value) : tokens(line.value),
    delta: line.change.text,
    share: pct(line.share, 1),
    cum: pct(line.cumulative),
    tokens: metric === "cost" ? tokens(sumOf(line.tally.tokens)) : usd(sumOf(line.tally.cost)),
    hit: pct(hitRate(line.tally), 1),
    rate: usd(line.rate),
    turns: count(line.tally.turns),
    trend: "",
  });

  const labels: Readonly<Record<ColumnKey, string>> = {
    rank: "#",
    name: "Name",
    value: valueLabel,
    delta: "Δ Prev",
    share: "Share",
    cum: "Cum",
    tokens: otherLabel,
    hit: "Hit",
    rate: "$/Mtok",
    turns: "Turns",
    trend: "Trend",
  };

  // Every column but the name shrinks to its widest cell, header included; the name takes the rest.
  const widths =
    family === null
      ? null
      : Object.fromEntries(
          COLUMNS.map((column) => {
            const font = dataFont(family);

            const content = widest(
              [labels[column.key].toUpperCase(), ...lines.map((line) => cells(line)[column.key])],
              font,
            );

            const extra = column.key === "cum" ? CUM_BAR + 8 : column.key === "trend" ? 72 : 0;
            const sortGlyph = SORTABLE[column.key] === undefined ? 0 : 10;

            return [column.key, Math.max(content, extra) + sortGlyph + 16];
          }),
        );

  return (
    <div {...props(styles.tableScroll)}>
      <table ref={setNode} {...props(styles.table)}>
        <colgroup>
          {COLUMNS.map((column) => (
            <col
              key={column.key}
              style={
                column.key === "name" || widths === null ? undefined : { width: widths[column.key] }
              }
            />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const key = SORTABLE[column.key];
              const active = key !== undefined && sort.key === key;

              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={active ? (sort.descending ? "descending" : "ascending") : undefined}
                  {...props(styles.th, column.align === "end" && styles.end)}
                >
                  {key === undefined ? (
                    labels[column.key]
                  ) : (
                    <button
                      type="button"
                      {...props(
                        styles.sort,
                        column.align === "end" && styles.sortEnd,
                        active && styles.sortActive,
                      )}
                      onClick={() =>
                        setSort({
                          key,
                          descending: active ? !sort.descending : key !== "rank",
                        })
                      }
                    >
                      {labels[column.key]}
                      <span aria-hidden="true" {...props(styles.sortGlyph)}>
                        {active ? (sort.descending ? "↓" : "↑") : ""}
                      </span>
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordered.map((line) => {
            const text = cells(line);
            const tail = line.rank > cut;
            const isSelected = line.row.id === selected;

            return (
              <tr
                key={line.row.id}
                aria-selected={isSelected}
                {...props(
                  styles.tr,
                  tail && styles.tail,
                  isSelected && styles.selected,
                  sort.key === "rank" && line.rank === cut && styles.cutRow,
                )}
                onClick={() => onSelect(isSelected ? null : line.row.id)}
              >
                <td {...props(styles.td, styles.end, styles.dim)}>{text.rank}</td>
                <td {...props(styles.td, styles.name)}>
                  <span {...props(styles.nameText)}>{text.name}</span>
                  <span {...props(styles.detail)}>{line.row.detail}</span>
                </td>
                <td {...props(styles.td, styles.end, styles.strong)}>{text.value}</td>
                <td
                  {...props(
                    styles.td,
                    styles.end,
                    line.change.sign === 0
                      ? styles.dim
                      : [TONE_SCOPE[toneOf(line.change.sign, metric === "tokens")], styles.toned],
                  )}
                >
                  {text.delta}
                </td>
                <td {...props(styles.td, styles.end)}>{text.share}</td>
                <td {...props(styles.td)}>
                  <span {...props(styles.cum)}>
                    <span {...props(styles.cumTrack)}>
                      <span
                        {...props(surfaceTheme.blue, styles.cumFill, tail && styles.cumTail)}
                        style={{ width: `${String(Math.min(line.cumulative, 1) * 100)}%` }}
                      />
                      <span {...props(styles.cumCut)} />
                    </span>
                    {text.cum}
                  </span>
                </td>
                <td {...props(styles.td, styles.end)}>{text.tokens}</td>
                <td {...props(styles.td, styles.end)}>{text.hit}</td>
                <td {...props(styles.td, styles.end)}>{text.rate}</td>
                <td {...props(styles.td, styles.end)}>{text.turns}</td>
                <td {...props(styles.td)}>
                  <Sparkline
                    values={line.row.series.map((tally) => readTotal(tally, metric))}
                    tint={tail ? "gray" : "blue"}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr {...props(styles.foot)}>
            <td {...props(styles.td)} />
            <td {...props(styles.td, styles.dim)}>Total</td>
            <td {...props(styles.td, styles.end, styles.strong)}>
              {metric === "cost" ? usd(grand) : tokens(grand)}
            </td>
            <td {...props(styles.td)} />
            <td {...props(styles.td, styles.end)}>{pct(1, 1)}</td>
            <td {...props(styles.td, styles.dim)}>
              {cut + 1}/{lines.length} → {pct(lines[cut]?.cumulative ?? 1)}
            </td>
            <td {...props(styles.td, styles.end)}>
              {metric === "cost"
                ? tokens(totals.reduce((sum, tally) => sum + sumOf(tally.tokens), 0))
                : usd(totals.reduce((sum, tally) => sum + sumOf(tally.cost), 0))}
            </td>
            <td {...props(styles.td, styles.end)}>{pct(hitRate(seriesTotal(totals)), 1)}</td>
            <td {...props(styles.td, styles.end)}>
              {usd(
                sumOf(seriesTotal(totals).cost) /
                  Math.max(sumOf(seriesTotal(totals).tokens) / 1e6, Number.EPSILON),
              )}
            </td>
            <td {...props(styles.td, styles.end)}>{count(seriesTotal(totals).turns)}</td>
            <td {...props(styles.td)} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const LIMIT_TINT = { calm: "blue", warm: "yellow", hot: "red" } as const;

function heat(value: number): keyof typeof LIMIT_TINT {
  if (value >= 90) return "hot";

  if (value >= 70) return "warm";

  return "calm";
}

function LimitsView(): ReactElement {
  const lines = ACCOUNTS.map((account) => ({ account, ...project(account) })).toSorted(
    (a, b) => (a.fillsIn ?? Infinity) - (b.fillsIn ?? Infinity) || b.used - a.used,
  );

  const filling = lines.filter((line) => line.fillsIn !== null);
  const nextReset = lines.toSorted((a, b) => a.resetsIn - b.resetsIn)[0];
  const hottest = lines.toSorted((a, b) => b.used - a.used)[0];

  return (
    <>
      <div {...props(styles.ticker)}>
        <Cell
          label="Windows"
          value={count(lines.length)}
          sub={`${count(new Set(ACCOUNTS.map((a) => a.provider)).size)} providers`}
        />
        <Cell
          label="Fill before reset"
          value={count(filling.length)}
          sub={filling[0] === undefined ? "none" : `first in ${duration(filling[0].fillsIn ?? 0)}`}
          tone={filling.length > 0 ? "bad" : "good"}
        />
        <Cell
          label="Hottest"
          value={pct((hottest?.used ?? 0) / 100)}
          sub={
            hottest === undefined
              ? undefined
              : `${hottest.account.provider} ${hottest.account.window}`
          }
          tone={(hottest?.used ?? 0) >= 90 ? "bad" : "neutral"}
        />
        <Cell
          label="Next reset"
          value={duration(nextReset?.resetsIn ?? 0)}
          sub={
            nextReset === undefined
              ? undefined
              : `${nextReset.account.provider} ${nextReset.account.window}`
          }
        />
        <Cell
          label="Headroom 5H"
          value={pct(
            lines
              .filter((line) => line.account.window === "5h")
              .reduce((sum, line) => sum + (100 - line.used), 0) /
              100 /
              Math.max(1, lines.filter((line) => line.account.window === "5h").length),
          )}
          sub="avg left"
        />
      </div>
      <section aria-label="Windows" {...props(styles.panel)}>
        <div {...props(styles.panelBar)}>
          <span {...props(styles.panelTitle)}>Windows</span>
          <span {...props(styles.grow)} />
          <span {...props(styles.stamp)}>sorted by time to full</span>
        </div>
        <LimitsTable lines={lines} />
      </section>
    </>
  );
}

function LimitsTable({
  lines,
}: {
  readonly lines: readonly (ReturnType<typeof project> & { readonly account: Account })[];
}): ReactElement {
  return (
    <div {...props(styles.tableScroll)}>
      <table {...props(styles.table)}>
        <thead>
          <tr>
            {[
              "Provider",
              "Plan",
              "Window",
              "Used",
              "Left",
              "Pace/H",
              "At reset",
              "Full in",
              "Resets in",
              "Trace",
            ].map((label, index) => (
              <th
                key={label}
                scope="col"
                {...props(styles.th, index >= 4 && index <= 8 && styles.end)}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => {
            const tint =
              LIMIT_TINT[
                heat(line.fillsIn === null ? Math.max(line.used, line.atReset * 0.9) : 100)
              ];

            return (
              <tr key={`${line.account.provider}-${line.account.window}`} {...props(styles.tr)}>
                <td {...props(styles.td, styles.strong)}>{line.account.provider}</td>
                <td {...props(styles.td, styles.dim)}>{line.account.plan}</td>
                <td {...props(styles.td)}>{line.account.window}</td>
                <td {...props(styles.td)}>
                  <span {...props(styles.cum)}>
                    <span {...props(styles.cumTrack)}>
                      <span
                        {...props(surfaceTheme[LIMIT_TINT[heat(line.used)]], styles.cumFill)}
                        style={{ width: `${String(line.used)}%` }}
                      />
                    </span>
                    <span
                      {...props(
                        line.used >= 70 && [
                          surfaceTheme[LIMIT_TINT[heat(line.used)]],
                          styles.toned,
                        ],
                      )}
                    >
                      {pct(line.used / 100)}
                    </span>
                  </span>
                </td>
                <td {...props(styles.td, styles.end)}>{pct((100 - line.used) / 100)}</td>
                <td {...props(styles.td, styles.end)}>{line.pacePerHour.toFixed(1)}%</td>
                <td
                  {...props(
                    styles.td,
                    styles.end,
                    line.atReset >= 100 && [intent.danger, styles.toned],
                  )}
                >
                  {line.atReset >= 100 ? "100%+" : pct(line.atReset / 100)}
                </td>
                <td
                  {...props(
                    styles.td,
                    styles.end,
                    line.fillsIn === null
                      ? styles.dim
                      : [intent.danger, styles.toned, styles.strong],
                  )}
                >
                  {line.fillsIn === null ? "—" : duration(line.fillsIn)}
                </td>
                <td {...props(styles.td, styles.end)}>{duration(line.resetsIn)}</td>
                <td {...props(styles.td)} style={{ width: TRACE_WIDTH + 16 }}>
                  <LimitTrace account={line.account} tint={tint} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const styles = create({
  page: {
    minBlockSize: "100dvh",
    padding: { default: 8, "@media (min-width: 960px)": 16 },
    paddingBlockEnd: 64,
    backgroundColor: role.bgChrome,
    color: role.contentPrimary,
    fontFamily: type.fontSans,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  frame: {
    display: "flex",
    flexDirection: "column",
    marginInline: "auto",
    maxInlineSize: 1280,
    overflow: "hidden",
    borderRadius: radius.surface,
    backgroundColor: role.bgBase,
    boxShadow: `0 0 0 1px ${role.borderSecondary}`,
  },
  bar: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingBlock: 8,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondary,
  },
  title: { margin: 0, fontSize: type.fontBase, fontWeight: 600, lineHeight: type.leadingBase },
  grow: { flexGrow: 1 },
  stamp: {
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  ticker: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(124px, 1fr))",
    gap: 1,
    backgroundColor: role.borderSecondary,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondary,
  },
  cell: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    paddingBlock: 8,
    paddingInline: 12,
    backgroundColor: role.bgBase,
  },
  cellLabel: {
    color: role.contentTertiary,
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: "0.06em",
    lineHeight: "14px",
    textTransform: "uppercase",
  },
  cellValue: {
    fontFamily: type.fontMono,
    fontSize: 17,
    fontWeight: 500,
    lineHeight: "22px",
    letterSpacing: "-0.02em",
    fontVariantNumeric: "tabular-nums",
  },
  cellSub: {
    color: role.contentTertiary,
    fontFamily: type.fontMono,
    fontSize: 11,
    lineHeight: "14px",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  toned: { color: role.contentInteractivePrimary },
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    paddingBlock: 10,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondary,
  },
  panelBar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 },
  panelTitle: {
    color: role.contentSecondary,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.06em",
    lineHeight: "14px",
    textTransform: "uppercase",
  },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    paddingBlock: 1,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: radius.indicator,
    backgroundColor: {
      default: role.bgInteractiveSecondary,
      ":hover": role.bgInteractiveSecondaryHover,
    },
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontSize: 11,
    lineHeight: "18px",
    cursor: "pointer",
  },
  keys: { display: "flex", flexWrap: "wrap" },
  key: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    paddingBlock: 2,
    paddingInline: 6,
    borderRadius: radius.indicator,
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    color: role.contentSecondary,
    fontSize: 11,
    lineHeight: "16px",
    cursor: "default",
  },
  keyValue: {
    color: role.contentPrimary,
    fontFamily: type.fontMono,
    fontVariantNumeric: "tabular-nums",
  },
  swatch: {
    inlineSize: 7,
    blockSize: 7,
    borderRadius: 1,
    backgroundColor: role.bgInteractiveStrong,
  },
  dash: {
    inlineSize: 10,
    borderTopWidth: 1,
    borderTopStyle: "dashed",
    borderTopColor: role.contentSecondary,
  },
  solid: {
    inlineSize: 10,
    borderTopWidth: 1.5,
    borderTopStyle: "solid",
    borderTopColor: role.contentPrimary,
  },
  tableScroll: { overflowX: "auto", marginInline: -12 },
  table: {
    inlineSize: "100%",
    minInlineSize: 880,
    borderCollapse: "collapse",
    tableLayout: "fixed",
    fontFamily: type.fontMono,
    // DATA_SIZE: StyleX needs the literal, and Pretext sizes the columns at it.
    fontSize: 11,
    lineHeight: "16px",
    fontVariantNumeric: "tabular-nums",
  },
  th: {
    paddingBlock: 4,
    paddingInline: 8,
    color: role.contentTertiary,
    fontWeight: 500,
    textAlign: "start",
    textTransform: "uppercase",
    whiteSpace: "nowrap",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondary,
  },
  end: { textAlign: "end" },
  sort: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: "inherit", ":hover": role.contentPrimary },
    fontFamily: "inherit",
    fontSize: "inherit",
    fontWeight: "inherit",
    textTransform: "inherit",
    cursor: "pointer",
  },
  sortEnd: { flexDirection: "row-reverse" },
  sortActive: { color: role.contentPrimary },
  sortGlyph: { display: "inline-block", inlineSize: 8 },
  tr: {
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": role.bgHover },
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondary,
  },
  cutRow: { borderBottomStyle: "dashed", borderBottomColor: role.borderStrong },
  tail: { color: role.contentSecondary },
  selected: { backgroundColor: role.bgPressed },
  td: {
    paddingBlock: 5,
    paddingInline: 8,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  name: { fontFamily: type.fontMono },
  nameText: { color: "inherit" },
  detail: { paddingInlineStart: 8, color: role.contentTertiary },
  strong: { fontWeight: 600 },
  dim: { color: role.contentTertiary },
  cum: { display: "flex", alignItems: "center", gap: 8 },
  cumTrack: {
    position: "relative",
    display: "flex",
    flexShrink: 0,
    inlineSize: CUM_BAR,
    blockSize: 6,
    overflow: "hidden",
    borderRadius: 1,
    backgroundColor: role.bgMuted,
  },
  cumFill: { blockSize: "100%", backgroundColor: role.bgInteractiveStrong },
  cumTail: { opacity: 0.35 },
  // The cut at 80% of the track.
  cumCut: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: "80%",
    inlineSize: 1,
    backgroundColor: role.contentPrimary,
  },
  foot: { color: role.contentSecondary, fontWeight: 500 },
});
