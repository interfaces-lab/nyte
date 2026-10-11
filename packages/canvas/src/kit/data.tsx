import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";
import { Meter as MeterControl } from "@nyte-ai/ui/meter";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { intent, surfaceTheme } from "@nyte-ai/ui/surface-theme";
import { role, shadow, type } from "@nyte-ai/ui/vars.stylex";

export type StatTone = "neutral" | "success" | "warning" | "danger";

export type BadgeTone = "neutral" | "info" | StatTone;

const tones = {
  neutral: null,
  info: surfaceTheme.blue,
  success: intent.success,
  warning: intent.warning,
  danger: intent.danger,
} as const;

const stat = create({
  root: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  label: { color: role.contentSecondary, fontSize: type.fontSm, lineHeight: type.leadingSm },
  value: {
    color: role.contentPrimary,
    fontSize: type.font2xl,
    lineHeight: type.leadingLg,
    fontWeight: 600,
    letterSpacing: type.letterLg,
    fontVariantNumeric: "tabular-nums",
  },
  detail: { color: role.contentSecondary, fontSize: type.fontSm, lineHeight: type.leadingSm },
  detailToned: { color: role.contentSecondary, fontWeight: 500 },
});

export function Stat({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly detail?: ReactNode;
  readonly tone?: StatTone;
}): ReactElement {
  return (
    <div {...props(stat.root)}>
      <span {...props(stat.label)}>{label}</span>
      <span {...props(stat.value)}>{value}</span>
      {detail === undefined ? null : (
        <span {...props(tones[tone], stat.detail, tone !== "neutral" && stat.detailToned)}>
          {detail}
        </span>
      )}
    </div>
  );
}

const badge = create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 20,
    paddingInline: 8,
    borderRadius: radius.pill,
    backgroundColor: role.bgMutedTranslucent,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
    fontWeight: 500,
    whiteSpace: "nowrap",
  },
  toned: { backgroundColor: role.bgInteractiveSecondaryTranslucent, color: role.contentSecondary },
});

export function Badge({
  tone = "neutral",
  children,
}: {
  readonly tone?: BadgeTone;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <span {...props(tones[tone], badge.root, tone !== "neutral" && badge.toned)}>{children}</span>
  );
}

const meter = create({
  head: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 },
  label: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

/** The ui meter composed for one call: a label with the value over the bar, the bar painted in the tone's intent. */
export function Meter({
  value,
  max = 100,
  label,
  tone = "primary",
}: {
  readonly value: number;
  readonly max?: number;
  readonly label?: string;
  readonly tone?: "primary" | "success" | "warning" | "danger";
}): ReactElement {
  return (
    <MeterControl.Root
      value={value}
      max={max}
      aria-label={label === undefined ? "Meter" : undefined}
    >
      {label === undefined ? null : (
        <div {...props(meter.head)}>
          <MeterControl.Label xstyle={meter.label}>{label}</MeterControl.Label>
          <MeterControl.Value />
        </div>
      )}
      <MeterControl.Track>
        <MeterControl.Indicator xstyle={tone === "primary" ? undefined : intent[tone]} />
      </MeterControl.Track>
    </MeterControl.Root>
  );
}

const table = create({
  wrap: { minWidth: 0, overflowX: "auto" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontVariantNumeric: "tabular-nums",
  },
  head: {
    paddingBlock: 6,
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderPrimary,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    fontWeight: 500,
    textAlign: "start",
    whiteSpace: "nowrap",
  },
  cell: {
    paddingBlock: 6,
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondary,
    textAlign: "start",
    verticalAlign: "middle",
  },
  end: { textAlign: "end" },
  lastRow: { borderBottomWidth: 0 },
  caption: {
    captionSide: "bottom",
    paddingTop: 8,
    paddingInline: 8,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    textAlign: "start",
  },
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

export function Table({
  columns,
  rows,
  caption,
}: {
  readonly columns: readonly Column[];
  readonly rows: readonly Readonly<Record<string, ReactNode>>[];
  readonly caption?: string;
}): ReactElement {
  return (
    <div {...props(table.wrap)}>
      <table {...props(table.table)}>
        {caption === undefined ? null : <caption {...props(table.caption)}>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                {...props(
                  table.head,
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
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  {...props(
                    table.cell,
                    column.align === "end" && table.end,
                    index === rows.length - 1 && table.lastRow,
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

const callout = create({
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "10px 12px",
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderPrimaryTranslucent,
    backgroundColor: role.bgInteractiveSecondaryTranslucent,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  title: { color: role.contentSecondary, fontWeight: 600 },
});

export function Callout({
  tone = "info",
  title,
  children,
}: {
  readonly tone?: "info" | "success" | "warning" | "danger";
  readonly title?: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "note"}
      {...props(tones[tone], callout.root)}
    >
      {title === undefined ? null : <span {...props(callout.title)}>{title}</span>}
      <div>{children}</div>
    </div>
  );
}

const card = create({
  root: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    borderRadius: radius.card,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: role.borderPrimary,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowSm,
    color: role.contentPrimary,
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingBlock: 10,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: role.borderSecondary,
  },
  title: {
    minWidth: 0,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  actions: { display: "flex", alignItems: "center", gap: 4, flexShrink: 0 },
  body: { minWidth: 0 },
  0: { padding: 0 },
  2: { padding: 8 },
  3: { padding: 12 },
  4: { padding: 16 },
});

export function Card({
  title,
  actions,
  padding = 4,
  children,
}: {
  readonly title?: ReactNode;
  readonly actions?: ReactNode;
  readonly padding?: 0 | 2 | 3 | 4;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <section {...props(card.root)}>
      {title === undefined && actions === undefined ? null : (
        <header {...props(card.head)}>
          <span {...props(card.title)}>{title}</span>
          {actions === undefined ? null : <span {...props(card.actions)}>{actions}</span>}
        </header>
      )}
      <div {...props(card.body, card[padding])}>{children}</div>
    </section>
  );
}
