import type { ChartSeries } from "@nyte-ai/ui/chart";
import { Meter } from "@nyte-ai/ui/meter";
import { Tabs } from "@nyte-ai/ui/tabs";
import { Icon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { srOnly } from "@nyte-ai/ui/styles/a11y.stylex";
import { intent, surfaceTheme, type Tint } from "@nyte-ai/ui/surface-theme";
import { props } from "@stylexjs/stylex";
import { Fragment, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Deferred } from "../deferred.tsx";
import { useAccountLimits, useUsageReport } from "../queries.ts";
import { useChromeTab } from "./use-chrome-tab.ts";
import { amongOptions } from "./sidebar-view.ts";
import { skeletonStyles as bone, usageStyles as styles } from "./usage-settings.stylex.ts";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import {
  costChange,
  deriveAccount,
  deriveTools,
  deriveUsage,
  describeEmptyRange,
  describeTotals,
  formatPercent,
  formatTokens,
  formatUsd,
  spanLabel,
  timeLabel,
  usageWindow,
  USAGE_RANGE_LABELS,
  USAGE_RANGES,
  type UsageDerived,
  type UsageRange,
  type UsageRow,
} from "./usage-view.ts";

/** Rows past this are counted in one line: a ranked list is read from the top. */
const MAX_ROWS = 6;

/**
 * A window past these steps changes colour: warm says plan the rest of the
 * window, hot says the next request may not go through.
 */
const LIMIT_WARM_PERCENT = 70;

const LIMIT_HOT_PERCENT = 90;

type LimitTier = "calm" | "warm" | "hot";

function limitTier(used: number): LimitTier {
  if (used >= LIMIT_HOT_PERCENT) return "hot";

  if (used >= LIMIT_WARM_PERCENT) return "warm";

  return "calm";
}

const RANGE_OPTIONS = ["30d", "7d", "90d", "all"] as const satisfies readonly UsageRange[];

const AXES = ["models", "folders", "chats", "tools"] as const;

type Axis = (typeof AXES)[number];

const AXIS_LABELS: Readonly<Record<Axis, { tab: string; column: string; noun: string }>> = {
  models: { tab: "Models", column: "Model", noun: "model" },
  folders: { tab: "Folders", column: "Folder", noun: "folder" },
  chats: { tab: "Chats", column: "Chat", noun: "chat" },
  tools: { tab: "Tools", column: "Tool", noun: "tool" },
};

const RANK_TINTS = ["blue", "purple", "teal", "pink", "orange"] as const satisfies readonly Tint[];

function rowTint(row: UsageRow, rank: number): Tint | undefined {
  return row.share > 0 ? RANK_TINTS[rank] : undefined;
}

function percentOf(share: number): string {
  return `${String(Math.min(Math.max(share, 0), 1) * 100)}%`;
}

function useUsageRange() {
  return useChromeTab("usageRange", RANGE_OPTIONS);
}

function Bone({
  width,
  height,
}: {
  readonly width: number | string;
  readonly height: number;
}): ReactElement {
  return <span aria-hidden="true" {...props(bone.bone)} style={{ width, height }} />;
}

function Trend({ values }: { readonly values: readonly number[] }): ReactElement {
  return (
    <Deferred entry="charts" fallback={<Bone width={72} height={20} />}>
      {({ Sparkline }) => <Sparkline values={values} />}
    </Deferred>
  );
}

export function UsageRangePicker(): ReactElement {
  const [range, setRange] = useUsageRange();

  return (
    <Tabs.Root
      variant="segmented"
      value={range}
      onValueChange={(value) => {
        if (amongOptions(value, USAGE_RANGES)) setRange(value);
      }}
    >
      <Tabs.List aria-label="Usage range">
        {USAGE_RANGES.map((option) => (
          <Tabs.Tab key={option} value={option}>
            {USAGE_RANGE_LABELS[option]}
          </Tabs.Tab>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}

function Notice({
  children,
  alert,
  action,
}: {
  readonly children: ReactNode;
  readonly alert?: boolean;
  readonly action?: ReactNode;
}): ReactElement {
  return (
    <p role={alert === true ? "alert" : "status"} {...props(text.sm, styles.notice)}>
      <Icon
        name="warning"
        size={14}
        {...props(
          alert === true && intent.warning,
          styles.noticeIcon,
          alert === true && styles.noticeIconAlert,
        )}
      />
      <span {...props(styles.noticeCopy)}>{children}</span>
      {action}
    </p>
  );
}

function Empty({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action: ReactNode;
}): ReactElement {
  return (
    <div {...props(styles.empty)}>
      <span {...props(text.base, styles.emptyTitle)}>{title}</span>
      <p {...props(text.sm, styles.emptyBody)}>{body}</p>
      <span {...props(styles.emptyActions)}>{action}</span>
    </div>
  );
}

function chartLayers(usage: UsageDerived, rows: readonly UsageRow[]) {
  const ranked = rows.flatMap((row, rank) => {
    const tint = rowTint(row, rank);

    return tint === undefined || row.trend === undefined ? [] : [{ row, tint }];
  });

  const series: ChartSeries[] = ranked.map(({ row, tint }) => ({
    key: row.key,
    label: row.label,
    tint,
  }));

  const buckets = usage.points.map((point, index) => {
    const values = ranked.map(({ row }) => row.trend?.[index] ?? 0);
    const rest = point.value - values.reduce((sum, value) => sum + value, 0);

    return { key: point.key, label: point.label, values: [...values, Math.max(rest, 0)] };
  });

  return { series: [...series, { key: "other", label: "Other", tint: "gray" as const }], buckets };
}

function SpendCard({
  usage,
  rows,
  range,
  empty,
}: {
  readonly usage: UsageDerived | undefined;
  readonly rows: readonly UsageRow[] | undefined;
  readonly range: UsageRange;
  readonly empty: ReactNode;
}): ReactElement {
  if (usage === undefined || rows === undefined) {
    return (
      <section aria-busy="true" aria-label="Spend" {...props(styles.card, styles.spend)}>
        <span {...props(styles.spendTitle)}>
          <Bone width={132} height={10} />
          <Bone width={112} height={26} />
        </span>
        <Bone width="100%" height={88} />
      </section>
    );
  }

  if (empty !== undefined) {
    return (
      <section aria-label="Spend" {...props(styles.card, styles.spend)}>
        {empty}
      </section>
    );
  }

  const change = costChange(usage.totals.cost, usage.previousCost, range);
  const layers = chartLayers(usage, rows);
  const format = usage.measure === "cost" ? formatUsd : formatTokens;

  return (
    <section aria-label="Spend" {...props(styles.card, styles.spend)}>
      <div {...props(styles.spendHead)}>
        <span {...props(styles.spendTitle)}>
          <span {...props(text.sm, styles.caption)}>
            {usage.measure === "cost" ? "Spent" : "Used"} · {spanLabel(usage.from, usage.to)}
          </span>
          <span {...props(styles.amount)}>
            {usage.measure === "cost"
              ? formatUsd(usage.totals.cost)
              : `${formatTokens(usage.totals.tokens)} tokens`}
          </span>
        </span>
        <span {...props(styles.spendFacts)}>
          {change !== undefined && (
            <span
              {...props(
                text.sm,
                change.direction === "up" && intent.warning,
                change.direction === "down" && intent.success,
                styles.fact,
                change.direction !== "flat" && styles.change,
              )}
            >
              {change.label}
            </span>
          )}
          <span {...props(text.sm, styles.fact)}>{describeTotals(usage.totals)}</span>
        </span>
      </div>
      <Deferred entry="charts" fallback={<Bone width="100%" height={108} />}>
        {({ BarChart }) => (
          <BarChart
            label={`${usage.measure === "cost" ? "Spend" : "Tokens"} per ${usage.grain}`}
            series={layers.series}
            buckets={layers.buckets}
            format={format}
          />
        )}
      </Deferred>
    </section>
  );
}

function LimitsCard({
  limits,
}: {
  readonly limits: ReturnType<typeof useAccountLimits>;
}): ReactElement | null {
  const plans = useMemo(
    () => limits.data?.map(deriveAccount).filter((plan) => plan !== null),
    [limits.data],
  );

  if (plans !== undefined && plans.length === 0 && limits.error === null) return null;

  return (
    <section aria-label="Limits" {...props(styles.card, styles.limits)}>
      <div {...props(styles.limitsHead)}>
        <span {...props(text.sm, styles.caption)}>Limits</span>
        <Button
          variant="text"
          iconOnly
          icon="refresh"
          aria-label="Refresh account limits"
          loading={limits.isFetching}
          onClick={() => void limits.refetch({ cancelRefetch: false })}
        />
      </div>
      {limits.error !== null && (
        <p role="alert" {...props(text.xs, styles.quiet)}>
          Couldn&apos;t read plan limits. {limits.error.message}
        </p>
      )}
      {plans === undefined
        ? limits.error === null && (
            <span aria-busy="true" {...props(styles.spendTitle)}>
              <Bone width="70%" height={10} />
              <Bone width="100%" height={4} />
            </span>
          )
        : plans.map((plan) => (
            <Fragment key={plan.title}>
              {plan.message !== undefined && (
                <p role={plan.failed ? "alert" : undefined} {...props(text.xs, styles.quiet)}>
                  {plan.message}
                </p>
              )}
              {plan.meters.map((meter) => {
                const tier = limitTier(meter.used);
                const label = `${plan.title} · ${meter.label}`;

                return (
                  <Meter.Root
                    key={`${plan.title}/${meter.key}`}
                    value={meter.used}
                    getAriaValueText={() => `${String(meter.used)}% used`}
                  >
                    <span {...props(styles.meterHead)}>
                      <Meter.Label xstyle={text.base}>{label}</Meter.Label>
                      <span
                        {...props(
                          text.base,
                          tier === "warm" && intent.warning,
                          tier === "hot" && intent.danger,
                          styles.meterValue,
                          tier !== "calm" && styles.meterHot,
                        )}
                      >
                        {String(meter.used)}%
                      </span>
                    </span>
                    <Meter.Track xstyle={surfaceTheme.gray}>
                      <Meter.Indicator
                        xstyle={
                          tier === "calm"
                            ? undefined
                            : tier === "warm"
                              ? intent.warning
                              : intent.danger
                        }
                      />
                    </Meter.Track>
                    <span {...props(text.xs, styles.quiet)}>{meter.reset}</span>
                  </Meter.Root>
                );
              })}
            </Fragment>
          ))}
    </section>
  );
}

function BreakdownTable({
  axis,
  rows,
}: {
  readonly axis: Axis;
  readonly rows: readonly UsageRow[];
}): ReactElement {
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <div role="table" aria-label={`Spend by ${AXIS_LABELS[axis].noun}`} {...props(styles.table)}>
      <div role="row" {...props(styles.row, styles.headRow)}>
        <span role="columnheader" {...props(text.sm, styles.head, styles.nameCell)}>
          {AXIS_LABELS[axis].column}
        </span>
        <span role="columnheader" {...props(text.sm, styles.number, styles.cache, styles.head)}>
          Cache hit
        </span>
        <span role="columnheader" {...props(text.sm, styles.head, styles.trend)}>
          Trend
        </span>
        <span
          role="columnheader"
          {...props(text.sm, styles.head, styles.headStrong, styles.costHead)}
        >
          Cost
        </span>
      </div>
      {shown.map((row, rank) => {
        const tint = rowTint(row, rank);

        return (
          <div role="row" key={row.key} {...props(styles.row)}>
            <span role="cell" {...props(styles.nameCell)}>
              <span
                aria-hidden="true"
                {...props(
                  tint !== undefined && surfaceTheme[tint],
                  styles.dot,
                  tint === undefined && styles.dotIdle,
                )}
              />
              <span {...props(styles.name)}>
                <span {...props(text.base, styles.rowLabel)}>{row.label}</span>
                <span {...props(text.xs, styles.rowMeta)}>{row.meta}</span>
              </span>
            </span>
            <span role="cell" {...props(styles.number, styles.cache)}>
              <span
                {...props(
                  text.base,
                  row.cache.tone === "low" && intent.warning,
                  row.cache.tone === "low" && styles.cacheLow,
                  row.cache.tone === "absent" && styles.absent,
                )}
              >
                {row.cache.hit}
              </span>
              {row.cache.saved !== undefined && (
                <span {...props(text.xs, styles.rowMeta)}>{row.cache.saved}</span>
              )}
            </span>
            <span role="cell" {...props(styles.trend)}>
              {row.trend === undefined ? (
                <span {...props(text.base, styles.number, styles.absent)}>—</span>
              ) : (
                <Trend values={row.trend} />
              )}
            </span>
            <span role="cell" {...props(styles.cost)}>
              <span {...props(styles.costLine)}>
                {!row.value.absent && (
                  <span {...props(text.xs, styles.share)}>{formatPercent(row.share)}</span>
                )}
                <span {...props(text.base, styles.number, row.value.absent && styles.absent)}>
                  {row.value.text}
                </span>
              </span>
              <span aria-hidden="true" {...props(styles.shareTrack)}>
                <span
                  {...props(
                    tint !== undefined && surfaceTheme[tint],
                    styles.shareFill,
                    tint === undefined && styles.dotIdle,
                  )}
                  style={{ width: percentOf(row.share) }}
                />
              </span>
            </span>
          </div>
        );
      })}
      {hidden > 0 && <p {...props(text.sm, styles.more)}>+{String(hidden)} more</p>}
    </div>
  );
}

/** The heading and the query keep the day the panel opened on, even past midnight. */
export function UsageSettings(): ReactElement {
  const [openedAt] = useState(() => Date.now());
  const [range, setRange] = useUsageRange();
  const [axis, setAxis] = useChromeTab("usage", AXES);
  const view = useMemo(() => usageWindow(range, openedAt), [range, openedAt]);

  const { report, error, isFetching, refresh: refreshHistory } = useUsageReport(view.untilDay);
  const limits = useAccountLimits();

  const refresh = () => {
    refreshHistory();
    void limits.refetch({ cancelRefetch: false });
  };

  const usage = useMemo(
    () => (report === undefined ? undefined : deriveUsage(report, view)),
    [report, view],
  );

  const tools = useMemo(() => (report === undefined ? undefined : deriveTools(report)), [report]);

  const refreshButton = (
    <Button variant="outline" loading={isFetching || limits.isFetching} onClick={refresh}>
      Refresh Usage
    </Button>
  );

  if (report === undefined && error !== null) {
    return (
      <div {...props(styles.page)}>
        <div role="alert" {...props(styles.card)}>
          <Empty title="Couldn't read usage" body={error.message} action={refreshButton} />
        </div>
        <LimitsCard limits={limits} />
      </div>
    );
  }

  const empty =
    report === undefined || usage === undefined || report.entries.length > 0
      ? undefined
      : describeEmptyRange(report, usage.unreadFolders, range);

  const rowsFor = (of: Axis): readonly UsageRow[] | undefined =>
    of === "tools" ? tools : usage?.[of];

  const rows = rowsFor(axis);

  const chartRows =
    axis === "tools" && usage !== undefined && rows !== undefined
      ? rows.map((row) =>
          row.key === "nyte" ? { ...row, trend: usage.points.map((p) => p.value) } : row,
        )
      : rows;

  const hint =
    rows === undefined
      ? undefined
      : `${String(rows.length)} ${AXIS_LABELS[axis].noun}${rows.length === 1 ? "" : "s"} · ${
          axis === "tools" || range === "all"
            ? "all time"
            : `last ${USAGE_RANGE_LABELS[range].toLocaleLowerCase()}`
        }`;

  return (
    <div {...props(styles.page)}>
      {report === undefined && (
        <span role="status" {...props(srOnly)}>
          Reading local history…
        </span>
      )}
      {report !== undefined && error !== null && (
        <Notice
          alert
          action={
            <Button variant="text" onClick={refresh}>
              Refresh Usage
            </Button>
          }
        >
          Showing the last good read, from {timeLabel(report.readAt)}. {error.message}
        </Notice>
      )}
      {error === null && usage !== undefined && usage.unreadFolders.length > 0 && (
        <Notice>
          Couldn&apos;t read {usage.unreadFolders.join(", ")}.{" "}
          {usage.unreadFolders.length === 1 ? "Its" : "Their"} usage is missing from these totals.
        </Notice>
      )}

      <div {...props(styles.overview)}>
        <SpendCard
          usage={usage}
          rows={chartRows}
          range={range}
          empty={
            empty === undefined ? undefined : (
              <Empty
                title={empty.title}
                body={empty.body}
                action={
                  empty.offerAllTime ? (
                    <Button variant="solid" tone="primary" onClick={() => setRange("all")}>
                      Show All Time
                    </Button>
                  ) : (
                    refreshButton
                  )
                }
              />
            )
          }
        />
        <LimitsCard limits={limits} />
      </div>

      {empty === undefined && (
        <Tabs.Root
          variant="segmented"
          value={axis}
          onValueChange={(next) => {
            if (amongOptions(next, AXES)) setAxis(next);
          }}
          xstyle={styles.breakdown}
        >
          <div {...props(styles.breakdownHead)}>
            <Tabs.List aria-label="Split spend by">
              {AXES.map((option) => (
                <Tabs.Tab key={option} value={option}>
                  {AXIS_LABELS[option].tab}
                </Tabs.Tab>
              ))}
            </Tabs.List>
            {hint !== undefined && <span {...props(text.sm, styles.fact)}>{hint}</span>}
          </div>
          {AXES.map((option) => {
            const optionRows = rowsFor(option);

            return (
              <Tabs.Panel key={option} value={option}>
                {optionRows === undefined ? (
                  <div aria-busy="true" {...props(styles.table)}>
                    {Array.from({ length: 3 }, (_slot, index) => (
                      <span key={index} {...props(styles.row)}>
                        <Bone width={index === 0 ? 168 : 124} height={10} />
                      </span>
                    ))}
                  </div>
                ) : (
                  <BreakdownTable axis={option} rows={optionRows} />
                )}
              </Tabs.Panel>
            );
          })}
        </Tabs.Root>
      )}
    </div>
  );
}
