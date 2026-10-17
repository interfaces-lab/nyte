/** The breakdown table under the spend chart: sortable lines with a cumulative share bar. */
import { props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement } from "react";
import { surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { Sparkline, hitRate, readTotal, type Metric } from "./charts";
import { seriesTotal, sumKinds, type Row, type Tally } from "./fixtures";
import { count, delta, pct, tokens, usd } from "./format";
import { dataFont, useFamily, widest } from "./measure";
import { TONE_SCOPE, judgeTone } from "./cells";
import { CUM_BAR, styles } from "./page.stylex";

const PARETO_CUT = 0.8;

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

export function Breakdown({
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
        rate: sumKinds(tally.cost) / Math.max(sumKinds(tally.tokens) / 1e6, Number.EPSILON),
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
        return metric === "cost" ? sumKinds(line.tally.tokens) : sumKinds(line.tally.cost);
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
    tokens:
      metric === "cost" ? tokens(sumKinds(line.tally.tokens)) : usd(sumKinds(line.tally.cost)),
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
                      : [
                          TONE_SCOPE[judgeTone(line.change.sign, metric === "tokens")],
                          styles.toned,
                        ],
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
                ? tokens(totals.reduce((sum, tally) => sum + sumKinds(tally.tokens), 0))
                : usd(totals.reduce((sum, tally) => sum + sumKinds(tally.cost), 0))}
            </td>
            <td {...props(styles.td, styles.end)}>{pct(hitRate(seriesTotal(totals)), 1)}</td>
            <td {...props(styles.td, styles.end)}>
              {usd(
                sumKinds(seriesTotal(totals).cost) /
                  Math.max(sumKinds(seriesTotal(totals).tokens) / 1e6, Number.EPSILON),
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
