/**
 * Settings › Usage, one tab per question: what Nyte cost and which models spent
 * it, how much of each subscription is left, where inside Nyte the spend went,
 * and what every tool has recorded all time. The strip summarises each tab so
 * a glance answers the question without opening it.
 *
 * The page reads local history once per visit and the providers' limit windows
 * once per visit. A range press is arithmetic over the report already in hand,
 * and only the tabs a range applies to show one. Every list is the same two
 * parts, a stacked bar and the rows that name its segments, so nothing here is
 * legible only under the pointer and a long name wraps instead of being cut off.
 */
import { ResponsiveLine } from "@nivo/line";
import { Tabs } from "@nyte-ai/ui/tabs";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { Toggle } from "@nyte-ai/ui/toggle";
import * as stylex from "@stylexjs/stylex";
import { useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { Icon } from "../components/icons.tsx";
import { Button, focus, srOnly } from "../components/ui.tsx";
import { useAccountLimits, useUsageReport } from "../queries.ts";
import { t } from "../theme/vars.stylex.ts";
import { isOption } from "./sidebar-view.ts";
import { skeletonStyles as bone, usageStyles as styles } from "./usage-settings.stylex.ts";
import {
  costChange,
  dayLabel,
  deriveAccount,
  deriveLocalHistory,
  deriveTools,
  deriveUsage,
  describeEmptyRange,
  describeTotals,
  formatPercent,
  formatTokens,
  formatUsd,
  timeLabel,
  usageWindow,
  LOCAL_TOOLS,
  USAGE_RANGE_LABELS,
  USAGE_RANGES,
  USAGE_TOOL_LABELS,
  type UsageDerived,
  type UsagePoint,
  type UsageRange,
  type UsageRow,
} from "./usage-view.ts";

/** Rows past this are counted in one line: a ranked list is read from the top. */
const MAX_ROWS = 5;

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

const USAGE_TABS = ["spend", "limits", "where", "tools"] as const;
type UsageTab = (typeof USAGE_TABS)[number];

const WHERE_TABS = ["folders", "chats"] as const;

/** One colour per rank, shared by a bar segment and the row that names it. */
const RANK_COLOURS = [
  styles.series0,
  styles.series1,
  styles.series2,
  styles.series3,
  styles.series4,
] as const;

/** Tokens by kind, on the same ramp as the ranked lists so colour means one thing. */
const TOKEN_SERIES = [
  { id: "Input", colour: t.accent, swatch: styles.series0, read: (p: UsagePoint) => p.input },
  { id: "Output", colour: t.purple, swatch: styles.series1, read: (p: UsagePoint) => p.output },
  { id: "Cached", colour: t.cyan, swatch: styles.series2, read: (p: UsagePoint) => p.cached },
] as const;

/** Ticks under the curve: the ends and a few evenly between, never every bucket. */
const CHART_TICKS = 5;

function rankColour(rank: number): stylex.StyleXStyles {
  return RANK_COLOURS[rank % RANK_COLOURS.length] ?? styles.series0;
}

function percentOf(share: number): string {
  return `${String(Math.min(Math.max(share, 0), 1) * 100)}%`;
}

function Bone({
  width,
  height,
}: {
  readonly width: number | string;
  readonly height: number;
}): ReactElement {
  return <span aria-hidden="true" {...stylex.props(bone.bone)} style={{ width, height }} />;
}

/** The line under the strip: when this tab's numbers are from, and its controls. */
function PanelHead({
  hint,
  actions,
}: {
  readonly hint: ReactNode;
  readonly actions?: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.heading)}>
      <span {...stylex.props(styles.hint)}>{hint}</span>
      {actions !== undefined && <span {...stylex.props(styles.headingActions)}>{actions}</span>}
    </div>
  );
}

/**
 * A whole split into its parts: one stacked bar, then the rows that name its
 * segments. The rows carry the numbers, so the bar needs no readout.
 */
function Breakdown({
  label,
  rows,
  empty,
}: {
  readonly label: string;
  readonly rows: readonly UsageRow[];
  readonly empty: string;
}): ReactElement {
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  return (
    <div {...stylex.props(styles.group)}>
      {shown.length === 0 ? (
        <p {...stylex.props(styles.row, styles.meta)}>{empty}</p>
      ) : (
        <>
          <span aria-hidden="true" {...stylex.props(styles.barSlot)}>
            <span {...stylex.props(styles.bar)}>
              {shown.map((row, rank) =>
                row.share <= 0 ? null : (
                  <span
                    key={row.key}
                    {...stylex.props(styles.barSegment, rankColour(rank))}
                    style={{ flexBasis: percentOf(row.share) }}
                  />
                ),
              )}
            </span>
          </span>
          <div role="list" aria-label={label}>
            {shown.map((row, rank) => (
              <div role="listitem" key={row.key} {...stylex.props(styles.row)}>
                <span {...stylex.props(styles.rowCopy)}>
                  <span {...stylex.props(styles.rowName)}>
                    <span aria-hidden="true" {...stylex.props(styles.dot, rankColour(rank))} />
                    {row.label}
                  </span>
                  <span {...stylex.props(styles.rowMeta, styles.rowMetaInset)}>{row.meta}</span>
                </span>
                <span
                  {...stylex.props(styles.rowValue, row.value.kind === "absent" && styles.absent)}
                >
                  {row.value.text}
                </span>
                <span {...stylex.props(styles.rowShare)}>{formatPercent(row.share)}</span>
              </div>
            ))}
            {hidden > 0 && <p {...stylex.props(styles.more)}>+{String(hidden)} more</p>}
          </div>
        </>
      )}
    </div>
  );
}

function BreakdownSkeleton({
  rows,
  bar = true,
}: {
  readonly rows: number;
  /** A list with no whole to split, such as the limit windows, waits without one. */
  readonly bar?: boolean;
}): ReactElement {
  return (
    <div aria-busy="true" {...stylex.props(styles.group)}>
      {bar && (
        <span {...stylex.props(styles.barSlot)}>
          <span {...stylex.props(styles.bar)} />
        </span>
      )}
      {Array.from({ length: rows }, (_slot, index) => (
        <span key={index} {...stylex.props(styles.row, bone.row)}>
          <Bone width={index === 0 ? 168 : 124} height={10} />
          <Bone width={index === 0 ? "58%" : "34%"} height={8} />
        </span>
      ))}
    </div>
  );
}

/**
 * Tokens per bucket across the window, one curve per kind. The legend names
 * the lines and the slice tooltip reads a bucket, so the shape is the point.
 */
function TokenCurve({ usage }: { readonly usage: UsageDerived }): ReactElement | null {
  const series = TOKEN_SERIES.filter((kind) => usage.points.some((point) => kind.read(point) > 0));
  if (usage.points.length < 2 || series.length === 0) return null;

  const last = usage.points.length - 1;
  const step = Math.max(1, Math.ceil(last / (CHART_TICKS - 1)));
  const ticks = Array.from({ length: Math.floor(last / step) }, (_slot, index) => index * step);
  const tickValues = ticks.at(-1) === last ? ticks : [...ticks, last];
  const labelAt = (index: number): string => usage.points[index]?.label ?? "";

  return (
    <div {...stylex.props(styles.chart)}>
      <span {...stylex.props(styles.chartLegend)}>
        {series.map((kind) => (
          <span key={kind.id} {...stylex.props(styles.chartKey)}>
            <span aria-hidden="true" {...stylex.props(styles.chartSwatch, kind.swatch)} />
            {kind.id}
          </span>
        ))}
      </span>
      <div {...stylex.props(styles.chartPlot)}>
        <ResponsiveLine
          data={series.map((kind) => ({
            id: kind.id,
            data: usage.points.map((point, index) => ({ x: index, y: kind.read(point) })),
          }))}
          role="img"
          ariaLabel={`Tokens per ${usage.grain}`}
          margin={{ top: 8, right: 8, bottom: 24, left: 44 }}
          xScale={{ type: "linear", min: 0, max: last }}
          yScale={{ type: "linear", min: 0, max: "auto", nice: true }}
          yFormat={formatTokens}
          curve="monotoneX"
          colors={series.map((kind) => kind.colour)}
          lineWidth={2}
          enablePoints={false}
          enableArea
          areaOpacity={0.1}
          enableGridX={false}
          gridYValues={3}
          axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 3, format: formatTokens }}
          axisBottom={{ tickSize: 0, tickPadding: 8, tickValues, format: labelAt }}
          enableSlices="x"
          enableCrosshair
          crosshairType="x"
          animate={false}
          theme={{
            text: { fontFamily: t.fontSans, fontSize: 11, fill: t.textTertiary },
            grid: { line: { stroke: t.strokeQuaternary, strokeWidth: 1 } },
            crosshair: { line: { stroke: t.textQuaternary, strokeWidth: 1, strokeOpacity: 1 } },
          }}
          sliceTooltip={({ slice }) => (
            <div {...stylex.props(styles.chartTip)}>
              <span {...stylex.props(styles.chartTipLabel)}>
                {labelAt(slice.points[0]?.data.x ?? 0)}
              </span>
              {slice.points.map((point) => (
                <span key={point.id} {...stylex.props(styles.chartTipRow)}>
                  <span {...stylex.props(styles.chartKey)}>
                    <span
                      aria-hidden="true"
                      {...stylex.props(styles.chartSwatch)}
                      style={{ backgroundColor: point.seriesColor }}
                    />
                    {point.seriesId}
                  </span>
                  <span>{point.data.yFormatted}</span>
                </span>
              ))}
            </div>
          )}
        />
      </div>
    </div>
  );
}

function LimitMeter({
  label,
  used,
  reset,
}: {
  readonly label: string;
  readonly used: number;
  readonly reset: string;
}): ReactElement {
  const tier = limitTier(used);

  return (
    <div {...stylex.props(styles.row)}>
      <span {...stylex.props(styles.meter, styles.rowCopy)}>
        <span {...stylex.props(styles.meterHead)}>
          <span {...stylex.props(styles.rowName)}>{label}</span>
          <span
            {...stylex.props(
              styles.rowValue,
              tier === "warm" && styles.warm,
              tier === "hot" && styles.hot,
            )}
          >
            {String(used)}% used
          </span>
        </span>
        <span
          role="progressbar"
          aria-label={`${label} limit`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={used}
          aria-valuetext={`${String(used)}% used`}
          {...stylex.props(styles.meterTrack)}
        >
          <span
            {...stylex.props(
              styles.meterFill,
              tier === "warm" && styles.meterFillWarm,
              tier === "hot" && styles.meterFillHot,
            )}
            style={{ width: percentOf(used / 100) }}
          />
        </span>
        <span {...stylex.props(styles.rowMeta)}>{reset}</span>
      </span>
    </div>
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
    <p role={alert === true ? "alert" : "status"} {...stylex.props(styles.notice)}>
      <Icon
        name="warning"
        size={14}
        {...stylex.props(styles.noticeIcon, alert === true && styles.noticeIconAlert)}
      />
      <span {...stylex.props(styles.noticeCopy)}>{children}</span>
      {action}
    </p>
  );
}

function EmptyPanel({
  title,
  body,
  action,
}: {
  readonly title: string;
  readonly body: string;
  readonly action: ReactNode;
}): ReactElement {
  return (
    <div {...stylex.props(styles.panel)}>
      <span {...stylex.props(styles.panelTitle)}>{title}</span>
      <p {...stylex.props(styles.panelBody)}>{body}</p>
      <span {...stylex.props(styles.panelActions)}>{action}</span>
    </div>
  );
}

/** A second strip inside a tab, underlined rather than chipped so it reads as nested. */
function SubTabs<Value extends string>({
  label,
  options,
  labels,
  children,
}: {
  readonly label: string;
  readonly options: readonly [Value, ...Value[]];
  readonly labels: Readonly<Record<Value, string>>;
  readonly children: (value: Value) => ReactNode;
}): ReactElement {
  const [value, setValue] = useState<Value>(options[0]);
  return (
    <Tabs.Root
      value={value}
      onValueChange={(next) => {
        if (isOption(next, options)) setValue(next);
      }}
      {...stylex.props(styles.subRoot)}
    >
      <Tabs.List aria-label={label} {...stylex.props(styles.subList)}>
        {options.map((option) => (
          <Tabs.Tab key={option} value={option} {...stylex.props(styles.subTab, focus.ring)}>
            {labels[option]}
          </Tabs.Tab>
        ))}
      </Tabs.List>
      {options.map((option) => (
        <Tabs.Panel key={option} value={option} keepMounted {...stylex.props(styles.subPanel)}>
          {children(option)}
        </Tabs.Panel>
      ))}
    </Tabs.Root>
  );
}

export function UsageSettings(): ReactElement {
  // Keep the heading and the query on the same day if the panel stays open past midnight.
  const [openedAt] = useState(() => Date.now());
  const [tab, setTab] = useState<UsageTab>("spend");
  const [range, setRange] = useState<UsageRange>("30d");
  const view = useMemo(() => usageWindow(range, openedAt), [range, openedAt]);

  const { report, error, isFetching, refresh } = useUsageReport(view.untilDay);
  const limits = useAccountLimits();
  const usage = useMemo(
    () => (report === undefined ? undefined : deriveUsage(report, view)),
    [report, view],
  );
  const tools = useMemo(() => (report === undefined ? undefined : deriveTools(report)), [report]);
  const histories = useMemo(
    () =>
      report === undefined
        ? undefined
        : LOCAL_TOOLS.map((tool) => ({ tool, history: deriveLocalHistory(tool, report[tool]) })),
    [report],
  );
  const plans = useMemo(() => limits.data?.map(deriveAccount), [limits.data]);
  // The strip names the one window closest to running out, once it is worth naming.
  const hottest = plans
    ?.flatMap((plan) => plan.meters.map((meter) => ({ plan: plan.title, used: meter.used })))
    .reduce<{ plan: string; used: number } | undefined>(
      (found, meter) => (found === undefined || meter.used > found.used ? meter : found),
      undefined,
    );
  const hottestTier = hottest === undefined ? "calm" : limitTier(hottest.used);

  const refreshButton = (
    <Button variant="secondary" disabled={isFetching} onClick={refresh}>
      {isFetching ? "Reading…" : "Refresh"}
    </Button>
  );
  const rangePicker = (
    <ToggleGroup
      value={[range]}
      aria-label="Usage range"
      {...stylex.props(styles.segments)}
      onValueChange={(next) => {
        // Keep the current range when its toggle is pressed again.
        const chosen = next.at(-1);
        if (chosen !== undefined) setRange(chosen);
      }}
    >
      {USAGE_RANGES.map((option) => (
        <Toggle key={option} value={option} {...stylex.props(styles.segment, focus.ring)}>
          {USAGE_RANGE_LABELS[option]}
        </Toggle>
      ))}
    </ToggleGroup>
  );

  if (report === undefined && error !== null) {
    return (
      <div role="alert">
        <EmptyPanel title="Couldn't read usage" body={error.message} action={refreshButton} />
      </div>
    );
  }

  const empty =
    report === undefined || usage === undefined || report.entries.length > 0
      ? undefined
      : describeEmptyRange(report, usage.unreadFolders, range);
  const emptyPanel =
    empty === undefined ? undefined : (
      <EmptyPanel
        title={empty.title}
        body={empty.body}
        action={
          empty.offerAllTime ? (
            <Button variant="primary" onClick={() => setRange("all")}>
              Show all time
            </Button>
          ) : (
            refreshButton
          )
        }
      />
    );
  const change =
    usage === undefined ? undefined : costChange(usage.totals.cost, usage.previousCost);
  const rangeHint =
    report === undefined || usage === undefined ? (
      <Bone width={168} height={9} />
    ) : (
      `${usage.from === usage.to ? dayLabel(usage.to) : `${dayLabel(usage.from)} – ${dayLabel(usage.to)}`} · read at ${timeLabel(report.readAt)}`
    );

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(next) => {
        if (isOption(next, USAGE_TABS)) setTab(next);
      }}
      {...stylex.props(styles.page)}
    >
      {report === undefined && (
        <span role="status" {...stylex.props(srOnly)}>
          Reading local history…
        </span>
      )}

      <Tabs.List aria-label="Usage" {...stylex.props(styles.tabList)}>
        <Tabs.Tab value="spend" {...stylex.props(styles.tab, focus.ring)}>
          Spend
          {usage !== undefined && empty === undefined && (
            <span {...stylex.props(styles.tabSummary)}>{formatUsd(usage.totals.cost)}</span>
          )}
        </Tabs.Tab>
        <Tabs.Tab value="limits" {...stylex.props(styles.tab, focus.ring)}>
          Limits
          {hottest !== undefined && hottestTier !== "calm" && (
            <span
              {...stylex.props(
                styles.tabSummary,
                hottestTier === "warm" && styles.warm,
                hottestTier === "hot" && styles.hot,
              )}
            >
              {hottest.plan.split(" · ")[0]} {String(hottest.used)}%
            </span>
          )}
        </Tabs.Tab>
        <Tabs.Tab value="where" {...stylex.props(styles.tab, focus.ring)}>
          Where
        </Tabs.Tab>
        <Tabs.Tab value="tools" {...stylex.props(styles.tab, focus.ring)}>
          All tools
          {tools !== undefined && <span {...stylex.props(styles.tabSummary)}>{tools.amount}</span>}
        </Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="spend" keepMounted {...stylex.props(styles.tabPanel)}>
        <PanelHead
          hint={rangeHint}
          actions={
            <>
              {refreshButton}
              {rangePicker}
            </>
          }
        />
        {report !== undefined && error !== null && (
          <Notice
            alert
            action={
              <button
                type="button"
                onClick={refresh}
                {...stylex.props(styles.noticeAction, focus.ring)}
              >
                Refresh
              </button>
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

        {usage === undefined ? (
          <>
            <span {...stylex.props(styles.headline)}>
              <Bone width={148} height={28} />
              <Bone width={264} height={10} />
            </span>
            <BreakdownSkeleton rows={4} />
          </>
        ) : (
          (emptyPanel ?? (
            <>
              <span {...stylex.props(styles.headline)}>
                <span {...stylex.props(styles.amount)}>
                  {formatTokens(usage.totals.tokens)} tokens
                </span>
                <span {...stylex.props(styles.meta)}>
                  {formatUsd(usage.totals.cost)} · {describeTotals(usage.totals)}
                  {change !== undefined && (
                    <>
                      {" · "}
                      <span
                        {...stylex.props(
                          change.direction === "up" && styles.changeUp,
                          change.direction === "down" && styles.changeDown,
                        )}
                      >
                        {change.label}
                      </span>
                      {" on the period before"}
                    </>
                  )}
                </span>
              </span>
              <TokenCurve usage={usage} />
              <h3 {...stylex.props(styles.label)}>By model</h3>
              <Breakdown
                label="Nyte spend by model"
                rows={usage.models}
                empty="No model recorded spend in this range."
              />
            </>
          ))
        )}
      </Tabs.Panel>

      <Tabs.Panel value="limits" keepMounted {...stylex.props(styles.tabPanel)}>
        <PanelHead hint="Live from each provider" />
        {limits.error !== null ? (
          <Notice alert>Couldn&apos;t read plan limits. {limits.error.message}</Notice>
        ) : plans === undefined ? (
          <BreakdownSkeleton rows={2} bar={false} />
        ) : (
          plans.map((plan) => (
            <div key={plan.title} {...stylex.props(styles.stack)}>
              <h3 {...stylex.props(styles.label)}>{plan.title}</h3>
              <div {...stylex.props(styles.group)}>
                {plan.message === undefined ? (
                  plan.meters.map((meter) => (
                    <LimitMeter
                      key={meter.key}
                      label={meter.label}
                      used={meter.used}
                      reset={meter.reset}
                    />
                  ))
                ) : (
                  <p
                    role={plan.failed ? "alert" : undefined}
                    {...stylex.props(styles.row, styles.meta)}
                  >
                    {plan.message}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </Tabs.Panel>

      <Tabs.Panel value="where" keepMounted {...stylex.props(styles.tabPanel)}>
        <PanelHead hint={rangeHint} actions={rangePicker} />
        {usage === undefined ? (
          <BreakdownSkeleton rows={4} />
        ) : (
          (emptyPanel ?? (
            <SubTabs
              label="Where it went"
              options={WHERE_TABS}
              labels={{ folders: "Folders", chats: "Chats" }}
            >
              {(where) =>
                where === "folders" ? (
                  <Breakdown
                    label="Nyte spend by folder"
                    rows={usage.folders}
                    empty="No folder recorded spend in this range."
                  />
                ) : (
                  <Breakdown
                    label="Nyte spend by chat"
                    rows={usage.chats}
                    empty="No chat recorded spend in this range."
                  />
                )
              }
            </SubTabs>
          ))
        )}
      </Tabs.Panel>

      <Tabs.Panel value="tools" keepMounted {...stylex.props(styles.tabPanel)}>
        <PanelHead hint="All time · from each tool's local history" actions={refreshButton} />
        <span {...stylex.props(styles.headline)}>
          <span {...stylex.props(styles.amount)}>
            {tools === undefined ? <Bone width={120} height={28} /> : tools.amount}
          </span>
          <span {...stylex.props(styles.meta)}>
            {tools === undefined ? <Bone width={248} height={10} /> : tools.meta}
          </span>
        </span>
        {tools === undefined ? (
          <BreakdownSkeleton rows={3} />
        ) : (
          <Breakdown label="Spend by tool" rows={tools.rows} empty="No tool history read." />
        )}
        <SubTabs label="Tool by model" options={LOCAL_TOOLS} labels={USAGE_TOOL_LABELS}>
          {(tool) => {
            const history = histories?.find((entry) => entry.tool === tool)?.history;
            if (history === undefined) return <BreakdownSkeleton rows={2} />;
            if (history.kind === "message") {
              return (
                <div {...stylex.props(styles.group)}>
                  <p
                    role={history.failed ? "alert" : undefined}
                    {...stylex.props(styles.row, styles.meta)}
                  >
                    {history.message}
                  </p>
                </div>
              );
            }
            return (
              <>
                <Breakdown
                  label={`${USAGE_TOOL_LABELS[tool]} spend by model`}
                  rows={history.rows}
                  empty="No usage records in the readable history."
                />
                {history.note !== undefined && <p {...stylex.props(styles.note)}>{history.note}</p>}
              </>
            );
          }}
        </SubTabs>
      </Tabs.Panel>
    </Tabs.Root>
  );
}
