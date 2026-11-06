import { create, props } from "@stylexjs/stylex";
import { use } from "react";
import type { ReactElement, ReactNode } from "react";
import { Sparkline } from "@nyte-ai/ui/chart";
import { Icon } from "@nyte-ai/ui/icon";
import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import type { Tint } from "@nyte-ai/ui/surface-theme";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { motion, role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { InsetContext } from "./surface.tsx";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES = {
  neutral: null,
  info: surfaceTheme.blue,
  success: intent.success,
  warning: intent.warning,
  danger: intent.danger,
} as const;

const chip = create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: space.s1,
    height: space.s5,
    paddingInline: space.s1_5,
    borderRadius: radius.indicator,
    backgroundColor: role.fillTertiary,
    color: role.contentSecondary,
    fontWeight: type.weightMedium,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    verticalAlign: "middle",
  },
  dot: {
    width: space.s1_5,
    height: space.s1_5,
    flexShrink: 0,
    borderRadius: radius.pill,
    backgroundColor: role.contentAccent,
  },
  neutralDot: { backgroundColor: role.contentTertiary },
});

/** A short status in a soft wash of its tone; `dot` leads it with a status mark. */
export function Badge({
  tone = "neutral",
  dot = false,
  children,
}: {
  readonly tone?: Tone;
  readonly dot?: boolean;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <span {...props(TONES[tone], text.sm, chip.root)}>
      {dot ? <span {...props(chip.dot, tone === "neutral" && chip.neutralDot)} /> : null}
      {children}
    </span>
  );
}

/** Up, down or flat, read from the sign the value is written with. */
function direction(value: string | number): "up" | "down" | "flat" {
  const written = typeof value === "number" ? Math.sign(value) : value.trim().charAt(0);

  if (written === 1 || written === "+") return "up";

  if (written === -1 || written === "-" || written === "\u2212") return "down";

  return "flat";
}

/**
 * A change against a baseline, coloured by whether it's good: up is good unless `invert`, as for a
 * cost. Numbers get their sign written for them.
 */
export function Delta({
  value,
  invert = false,
}: {
  readonly value: string | number;
  readonly invert?: boolean;
}): ReactElement {
  const way = direction(value);
  const good = way === "up" ? !invert : invert;
  const shown = typeof value === "number" && value > 0 ? `+${String(value)}` : String(value);

  return (
    <span {...props(way === "flat" ? null : TONES[good ? "success" : "danger"], text.sm, chip.root)}>
      {way === "flat" ? null : <Icon name={way === "up" ? "arrow-up" : "arrow-down"} size="2xs" />}
      {shown}
    </span>
  );
}

const stat = create({
  root: { display: "flex", flexDirection: "column", gap: space.s1, minWidth: 0 },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.s2,
    minWidth: 0,
    minHeight: space.s5,
  },
  label: {
    minWidth: 0,
    color: role.contentSecondary,
    fontWeight: type.weightMedium,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  figure: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    columnGap: space.s3,
    rowGap: space.s1,
    minWidth: 0,
  },
  value: {
    color: role.contentPrimary,
    fontWeight: type.weightSemibold,
    fontVariantNumeric: "tabular-nums",
  },
  detail: { color: role.contentTertiary },
  toned: { color: role.contentAccent },
});

/** A labelled number: the label with its delta chip over a large tabular figure and its trend. */
export function Stat({
  label,
  value,
  detail,
  tone = "neutral",
  delta,
  invert,
  trend,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  readonly tone?: "neutral" | "success" | "warning" | "danger";
  readonly delta?: string | number;
  readonly invert?: boolean;
  readonly trend?: readonly number[];
}): ReactElement {
  return (
    <div {...props(stat.root)}>
      <div {...props(stat.head)}>
        <span {...props(text.sm, stat.label)}>{label}</span>
        {delta === undefined ? null : <Delta value={delta} invert={invert} />}
      </div>
      <div {...props(stat.figure)}>
        <span {...props(text["2xl"], stat.value)}>{value}</span>
        {trend === undefined ? null : <Sparkline values={trend} width={64} height={20} />}
      </div>
      {detail === undefined ? null : (
        <span {...props(TONES[tone], text.sm, stat.detail, tone !== "neutral" && stat.toned)}>
          {detail}
        </span>
      )}
    </div>
  );
}

const meter = create({
  root: { display: "flex", flexDirection: "column", gap: space.s1_5, minWidth: 0 },
  head: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: space.s3 },
  label: {
    minWidth: 0,
    color: role.contentSecondary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  value: { color: role.contentPrimary, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" },
  detail: { color: role.contentTertiary },
  track: {
    height: space.s1_5,
    overflow: "hidden",
    borderRadius: radius.pill,
    backgroundColor: role.fillTertiary,
  },
  fill: (share: number) => ({
    width: `${String(share * 100)}%`,
    height: "100%",
    borderRadius: radius.pill,
    backgroundColor: role.chartSeries,
    transitionProperty: "width",
    transitionDuration: {
      default: motion.durationSlow,
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motion.easeOutQuint,
  }),
});

const METER_TONES = {
  primary: surfaceTheme.blue,
  success: intent.success,
  warning: intent.warning,
  danger: intent.danger,
} as const;

/** A share of a whole: label and percentage over a 6px rounded track; `detail` names the units. */
export function Meter({
  value,
  max = 100,
  label,
  detail,
  tone = "primary",
}: {
  readonly value: number;
  readonly max?: number;
  readonly label?: string;
  readonly detail?: ReactNode;
  readonly tone?: "primary" | "success" | "warning" | "danger";
}): ReactElement {
  const share = max <= 0 ? 0 : Math.min(Math.max(value / max, 0), 1);
  const percent = `${String(Math.round(share * 100))}%`;

  return (
    <div
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={percent}
      aria-label={label ?? "Meter"}
      {...props(meter.root)}
    >
      {label === undefined && detail === undefined ? null : (
        <div {...props(text.sm, meter.head)}>
          <span {...props(meter.label)}>{label}</span>
          <span {...props(meter.value)}>
            {detail === undefined ? null : <span {...props(meter.detail)}>{detail} · </span>}
            {percent}
          </span>
        </div>
      )}
      <div {...props(METER_TONES[tone], meter.track)}>
        <div {...props(meter.fill(share))} />
      </div>
    </div>
  );
}

const table = create({
  wrap: { minWidth: 0, overflowX: "auto" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    color: role.contentPrimary,
    fontVariantNumeric: "tabular-nums",
  },
  head: {
    paddingBlock: space.s2,
    paddingInline: space.s3,
    color: role.contentSecondary,
    fontWeight: type.weightMedium,
    textAlign: "start",
    whiteSpace: "nowrap",
  },
  cell: {
    paddingBlock: space.s2_5,
    paddingInline: space.s3,
    textAlign: "start",
    verticalAlign: "middle",
  },
  first: { paddingInlineStart: 0 },
  last: { paddingInlineEnd: 0 },
  firstInset: { paddingInlineStart: space.s4 },
  lastInset: { paddingInlineEnd: space.s4 },
  end: { textAlign: "end" },
  caption: {
    captionSide: "bottom",
    paddingTop: space.s2,
    color: role.contentTertiary,
    textAlign: "start",
  },
  captionInset: { paddingInline: space.s4, paddingBottom: space.s3 },
  width: (width: number | string) => ({
    width: typeof width === "number" ? `${String(width)}px` : width,
  }),
});

export type Column = {
  readonly key: string;
  readonly label: ReactNode;
  readonly align?: "start" | "end";
  readonly width?: number | string;
};

/**
 * Rows of facts. The edge cells sit on the content edge, so text lines up with the prose around the
 * table; inside a Card with no padding they move in to the card's 16px.
 */
export function Table({
  columns,
  rows,
  caption,
}: {
  readonly columns: readonly Column[];
  readonly rows: readonly Readonly<Record<string, ReactNode>>[];
  readonly caption?: string;
}): ReactElement {
  const inset = use(InsetContext);

  const edge = (index: number) => [
    index === 0 && (inset ? table.firstInset : table.first),
    index === columns.length - 1 && (inset ? table.lastInset : table.last),
  ];

  return (
    <div {...props(table.wrap)}>
      <table {...props(text.base, table.table)}>
        {caption === undefined ? null : (
          <caption {...props(text.sm, table.caption, inset && table.captionInset)}>
            {caption}
          </caption>
        )}
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope="col"
                {...props(
                  text.sm,
                  table.head,
                  hairline.blockEnd,
                  edge(index),
                  column.align === "end" && table.end,
                  column.width !== undefined && table.width(column.width),
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  {...props(
                    table.cell,
                    rowIndex !== rows.length - 1 && hairline.blockEnd,
                    edge(index),
                    column.align === "end" && table.end,
                  )}
                >
                  {row[column.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const list = create({
  root: { display: "flex", flexDirection: "column", margin: 0, minWidth: 0 },
  row: {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: space.s4,
    paddingBlock: space.s2,
  },
  inset: { paddingInline: space.s4 },
  key: { flexShrink: 0, color: role.contentSecondary },
  value: {
    minWidth: 0,
    margin: 0,
    color: role.contentPrimary,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
    overflowWrap: "anywhere",
  },
});

/** Labelled facts, one per row: the label at the start, its value at the end, a hairline between. */
export function KeyValue({
  items,
}: {
  readonly items: readonly { readonly label: ReactNode; readonly value: ReactNode }[];
}): ReactElement {
  const inset = use(InsetContext);

  return (
    <dl {...props(text.base, list.root)}>
      {items.map((item, index) => (
        <div
          key={index}
          {...props(
            list.row,
            inset && list.inset,
            index !== items.length - 1 && hairline.blockEnd,
          )}
        >
          <dt {...props(list.key)}>{item.label}</dt>
          <dd {...props(list.value)}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const DIFF_BLOCKS = 5;

const diff = create({
  root: { display: "inline-flex", alignItems: "center", gap: space.s1_5, whiteSpace: "nowrap" },
  count: { color: role.contentAccent, fontVariantNumeric: "tabular-nums" },
  blocks: { display: "inline-flex", gap: space.px },
  block: {
    width: space.s2,
    height: space.s2,
    borderRadius: space.px,
    backgroundColor: role.fillSecondary,
  },
  painted: { backgroundColor: role.chartSeries },
});

/** Lines added and removed, with five blocks split between them as GitHub draws it. */
export function DiffStat({
  added,
  removed,
}: {
  readonly added: number;
  readonly removed: number;
}): ReactElement {
  const total = added + removed;
  const green = total === 0 ? 0 : Math.round((added / total) * DIFF_BLOCKS);
  const red = total === 0 ? 0 : Math.min(DIFF_BLOCKS - green, Math.round((removed / total) * DIFF_BLOCKS));

  return (
    <span
      role="img"
      aria-label={`${String(added)} lines added, ${String(removed)} removed`}
      {...props(text.code, diff.root)}
    >
      <span {...props(intent.success, diff.count)}>+{added.toLocaleString()}</span>
      <span {...props(intent.danger, diff.count)}>−{removed.toLocaleString()}</span>
      <span {...props(diff.blocks)}>
        {Array.from({ length: DIFF_BLOCKS }, (_slot, index) => (
          <span
            key={index}
            {...props(
              index < green ? intent.success : index < green + red ? intent.danger : null,
              diff.block,
              index < green + red && diff.painted,
            )}
          />
        ))}
      </span>
    </span>
  );
}

const bars = create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: space.s1,
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  row: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    columnGap: space.s3,
  },
  track: { position: "relative", minWidth: 0 },
  bar: (share: number) => ({
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: 0,
    width: `${String(share * 100)}%`,
    minWidth: space.s1,
    borderRadius: radius.indicator,
    backgroundColor: role.fillSecondary,
  }),
  label: {
    position: "relative",
    display: "block",
    paddingBlock: space.s1,
    paddingInline: space.s2,
    color: role.contentPrimary,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  value: { color: role.contentSecondary, fontVariantNumeric: "tabular-nums", textAlign: "end" },
});

/** A ranked list: each label sits on a bar as long as its share of the largest value. */
export function BarList({
  data,
  format = (value) => value.toLocaleString(),
  tint = "blue",
}: {
  readonly data: readonly { readonly label: string; readonly value: number }[];
  readonly format?: (value: number) => string;
  readonly tint?: Tint;
}): ReactElement {
  const peak = Math.max(0, ...data.map((entry) => entry.value));

  return (
    <ul {...props(text.base, bars.root)}>
      {data.map((entry) => (
        <li key={entry.label} {...props(bars.row)}>
          <span {...props(bars.track)}>
            <span {...props(surfaceTheme[tint], bars.bar(peak === 0 ? 0 : entry.value / peak))} />
            <span {...props(bars.label)}>{entry.label}</span>
          </span>
          <span {...props(bars.value)}>{format(entry.value)}</span>
        </li>
      ))}
    </ul>
  );
}
